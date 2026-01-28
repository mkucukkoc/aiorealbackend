import { Router } from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';
import { config } from '../config';
import { setJson, getJson } from '../redis';
import { db } from '../firebase';
import { TokenService } from '../services/tokenService';
import { UserService } from '../services/userService';
import { SessionService } from '../services/sessionService';
import { auditService } from '../services/auditService';
import { authRateLimits } from '../middleware/rateLimitMiddleware';
import { admin } from '../firebase';
import { logger } from '../utils/logger';
import { cleanupDeletedAccountArtifacts, ensureFirebaseAuthUserProfile, restoreSoftDeletedUser } from '../services/reactivationService';
import { attachRouteLogger } from '../utils/routeLogger';
import { quotaService } from '../services/quotaService';
import { premiumService } from '../services/premiumService';

export function createGoogleAuthRouter(): Router {
  const r = Router();
  attachRouteLogger(r, 'googleAuth');

  r.post(
    '/start',
    authRateLimits.general,
    async (req, res) => {
      try {
        const ipAddress = (req as any).ip || (req as any).connection?.remoteAddress;
        const userAgent = (req as any).get('User-Agent');
        logger.info(
          { body: req.body, headers: req.headers, ipAddress, userAgent },
          '[GoogleAuth] /start request payload'
        );
        
        const { device_id } = req.body || {};
        if (!device_id) {
          logger.warn({ ipAddress, userAgent }, '[GoogleAuth] Missing device_id');
          return res.status(400).json({ error: 'invalid_request' });
        }
        
        const id = uuidv4();
        logger.debug('[GoogleAuth] Generated state ID:', id);
        
        await setJson(`gls:${id}`, { device_id, ipAddress, userAgent }, 600);
        logger.debug('[GoogleAuth] Stored session in Redis');
        
        const params = new URLSearchParams({
          client_id: config.google.clientId,
          redirect_uri: config.google.redirectUri,
          response_type: 'code',
          scope: 'openid email profile',
          state: id,
        });
        
        const authUrl = `https://accounts.google.com/o/oauth2/auth?${params}`;
        logger.info({ id, deviceId: device_id }, '[GoogleAuth] Generated auth URL');
        
        const responsePayload = { url: authUrl, id };
        logger.debug({ response: responsePayload }, '[GoogleAuth] /start response payload');
        return res.json(responsePayload);
      } catch (error) {
        logger.debug('[GoogleAuth] /start error:', error);
        logger.error({ error }, 'Google auth start error');
        return res.status(500).json({ error: 'internal_error' });
      }
    }
  );

  r.get('/status/:id', async (req, res) => {
    try {
      const requestPayload = { id: req.params.id };
      logger.info(requestPayload, '[GoogleAuth] /status request payload');
      const session = await getJson<any>(`gls:${req.params.id}`);
      logger.debug('[GoogleAuth] Retrieved session:', session);

      if (!session || !session.ready) {
        logger.warn({ ...requestPayload, session }, '[GoogleAuth] Session not ready');
        const responsePayload = { ready: false };
        logger.debug({ response: responsePayload }, '[GoogleAuth] /status response payload');
        return res.json(responsePayload);
      }

      logger.info({ ...requestPayload, ready: true }, '[GoogleAuth] Session ready');
      logger.debug({ response: session }, '[GoogleAuth] /status response payload');
      return res.json(session);
    } catch (error) {
      logger.debug('[GoogleAuth] /status error:', error);
      logger.error({ error }, 'Google auth status check error');
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  r.get(
    '/callback',
    authRateLimits.general,
    async (req, res) => {
      const { code, state } = req.query;
      const requestId = uuidv4();
      const ipAddress = (req as any).ip || (req as any).connection?.remoteAddress;
      const userAgent = (req as any).get('User-Agent');
      logger.info(
        { requestId, codePresent: Boolean(code), state, ipAddress, userAgent },
        '[GoogleAuth] /callback request payload'
      );

      if (typeof code !== 'string' || typeof state !== 'string') {
        logger.warn({ requestId }, '[GoogleAuth] /callback received invalid query parameters');
        return res.status(400).send('Invalid request');
      }

      logger.info({ requestId, step: 'redis_get', state }, '[GoogleAuth] callback flow step');
      const session = await getJson<any>(`gls:${state}`);
      logger.debug(
        { requestId, step: 'redis_get_result', hasSession: Boolean(session), hasDeviceId: Boolean(session?.device_id) },
        '[GoogleAuth] callback flow step'
      );
      if (!session || !session.device_id) {
        logger.warn({ requestId, state }, '[GoogleAuth] Invalid or missing state session');
        return res.status(400).send('Invalid state');
      }
      try {
        logger.info({ requestId, step: 'exchange_code_for_token' }, '[GoogleAuth] callback flow step');
        const tokenResp = await axios.post(
          'https://oauth2.googleapis.com/token',
          new URLSearchParams({
            code,
            client_id: config.google.clientId,
            client_secret: config.google.clientSecret,
            redirect_uri: config.google.redirectUri,
            grant_type: 'authorization_code',
          }),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const { access_token } = (tokenResp.data as any);
        logger.info(
          { requestId, step: 'token_exchange_ok', hasAccessToken: Boolean(access_token) },
          '[GoogleAuth] callback flow step'
        );
        logger.info({ requestId, step: 'fetch_userinfo' }, '[GoogleAuth] callback flow step');
        const userResp = await axios.get(
          `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${access_token}`
        );
        const payload = userResp.data as any;
        logger.debug(
          {
            requestId,
            step: 'userinfo_received',
            emailPresent: Boolean(payload?.email),
            emailVerified: Boolean(payload?.email_verified),
          },
          '[GoogleAuth] callback flow step'
        );
        const email = payload?.email;
        const emailVerified = payload?.email_verified;
        if (!email) return res.status(400).send('No email');

        const ipAddress = (req as any).ip || (req as any).connection?.remoteAddress;
        const userAgent = (req as any).get('User-Agent');

        // Check if user exists in our new auth system
        logger.info({ requestId, step: 'find_user_by_email', email }, '[GoogleAuth] callback flow step');
        let user = await UserService.findByEmail(email);
        let wasSoftDeleted = false;
        logger.info(
          { requestId, step: 'find_user_by_email_done', found: Boolean(user) },
          '[GoogleAuth] callback flow step'
        );
        
        if (user && (user.provider === 'password' || (user.passwordHash && user.passwordHash.length > 0))) {
          const errorMessage = 'Bu e-posta şifreyle kayıtlı. Lütfen e-posta ve şifrenizle giriş yapın.';
          await auditService.logAuthEvent('login', {
            userId: user.id,
            ipAddress,
            userAgent,
            success: false,
            errorMessage,
          });

          await setJson(`gls:${state}`, {
            ready: true,
            error: 'password_account_exists',
            message: errorMessage,
            deviceId: session.device_id,
          }, 600);

          logger.info({ requestId, email, state }, '[GoogleAuth] Password account exists - redirecting to app');
          const appRedirect = config.app?.redirectUri || 'avenia://auth';
          const redirectUrl = `${appRedirect}?state=${encodeURIComponent(state)}&error=password_account_exists`;
          return res.redirect(redirectUrl);
        }

        if (!user) {
          // Create new Google user in our auth system (this already handles Firebase Auth + subsc)
          logger.info({ requestId, step: 'create_google_user' }, '[GoogleAuth] callback flow step');
          user = await UserService.createGoogleUser(
            email,
            payload?.name || payload?.given_name || ''
          );
          
          logger.info('Google user created successfully via callback', {
            requestId,
            userId: user.id,
            email: user.email,
            operation: 'google_oauth_callback'
          });
        } else {
          const existingUser = user;
          if (!existingUser) {
            throw new Error('Invariant: existing user expected');
          }
          if ((existingUser as any).isDeleted || (existingUser as any).is_deleted) {
            wasSoftDeleted = true;
            logger.info(
              { requestId, step: 'restore_soft_deleted_user', userId: existingUser.id },
              '[GoogleAuth] callback flow step'
            );
            await restoreSoftDeletedUser(existingUser.id);
            user = {
              ...existingUser,
              isDeleted: false,
              is_deleted: false,
              deletedAt: null,
              premiumCancelledAt: null,
            } as any;
          } else {
            user = existingUser;
          }

          // Update last login for existing user
          logger.info(
            { requestId, step: 'update_user_last_login', userId: existingUser.id },
            '[GoogleAuth] callback flow step'
          );
          await UserService.updateUser(existingUser.id, {
            lastLoginAt: new Date(),
            ...(existingUser.provider !== 'google' ? { provider: 'google' } : {}),
          });

          // Also update Firebase Auth user if needed
          try {
            logger.info(
              { requestId, step: 'update_firebase_auth_user', userId: existingUser.id },
              '[GoogleAuth] callback flow step'
            );
            await admin.auth().updateUser(existingUser.id, {
              displayName: payload?.name || payload?.given_name || existingUser.name,
              emailVerified: true,
            });
          } catch (error) {
            logger.warn(
              { requestId, error, userId: existingUser.id },
              'Failed to update Firebase Auth user via callback'
            );
          }
        }

        if (!user) {
          throw new Error('Google auth failed: user record missing after creation');
        }

        const ensuredUser = user;

        // Create session using new session system
        const deviceInfo = {
          os: 'unknown',
          model: 'unknown',
          appVersion: '1.0.0',
          platform: 'web',
        };

        const { session: newSession, tokens } = await SessionService.createSession(
          ensuredUser.id,
          deviceInfo,
          session.device_id,
          ipAddress,
          userAgent
        );
        logger.info(
          { requestId, step: 'session_created', userId: ensuredUser.id, sessionId: newSession.id },
          '[GoogleAuth] callback flow step'
        );

        // Log successful Google auth
        await auditService.logAuthEvent('login', {
          userId: ensuredUser.id,
          sessionId: newSession.id,
          ipAddress,
          userAgent,
          deviceInfo,
          success: true,
        });

        if (wasSoftDeleted) {
          logger.info(
            { requestId, userId: ensuredUser.id },
            'Soft-deleted Google user reactivated via callback, cleaning artifacts'
          );
          await cleanupDeletedAccountArtifacts(ensuredUser.id);
          await ensureFirebaseAuthUserProfile(ensuredUser.id, {
            email: ensuredUser.email,
            name: ensuredUser.name,
          });
        }

        let firebaseCustomToken: string | undefined;
        try {
          logger.info(
            { requestId, step: 'create_firebase_custom_token', userId: ensuredUser.id },
            '[GoogleAuth] callback flow step'
          );
          firebaseCustomToken = await admin.auth().createCustomToken(ensuredUser.id, {
            email: ensuredUser.email,
            provider: 'google',
          });
        } catch (error) {
          logger.warn(
            { requestId, error, userId: ensuredUser.id, operation: 'google_custom_token' },
            'Failed to create Firebase custom token for Google user'
          );
        }

        const premiumStatus = await premiumService.getStatus(ensuredUser.id);
        await quotaService.ensureQuotaForUser(ensuredUser.id, {
          premium: premiumStatus?.premium,
          entitlementProductId: premiumStatus?.entitlementProductId ?? null,
        });
        
        const readyPayload = {
          ready: true,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          sessionId: tokens.sessionId,
          user: {
            id: ensuredUser.id,
            email: ensuredUser.email,
            name: ensuredUser.name,
            avatar: ensuredUser.avatar,
          },
          deviceId: session.device_id,
          firebaseCustomToken,
          firebase_token: firebaseCustomToken ?? null,
        };
        logger.info({ requestId, step: 'persist_ready_payload', state }, '[GoogleAuth] callback flow step');
        await setJson(`gls:${state}`, readyPayload, 600);
        logger.debug({ requestId, state, readyPayload }, '[GoogleAuth] /callback response payload');

        logger.info({
          requestId,
          userId: user.id,
          state,
          redirectUriConfigured: config.google.redirectUri,
          appRedirectUri: config.app?.redirectUri,
          deviceId: session.device_id,
        }, '[GoogleAuth] /callback processed successfully');
        return res
          .status(200)
          .send('<html><body>Login successful. You may close this window.</body></html>');
      } catch (error) {
        logger.error({ requestId, err: error, operation: 'googleAuth' }, 'Google auth error');
        
        // Log the error for debugging
        await auditService.logAuthEvent('login', {
          ipAddress: (req as any).ip || (req as any).connection?.remoteAddress,
          userAgent: (req as any).get('User-Agent'),
          success: false,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        });
        
        return res.status(500).send('Authentication failed');
      }
    }
  );

  return r;
}

function base64url(b: Buffer | string): string {
  const raw = Buffer.isBuffer(b) ? b : Buffer.from(b);
  return raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(d.getDate() + days);
  return x;
}