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
import { attachRouteLogger } from '../utils/routeLogger';
import * as jwt from 'jsonwebtoken';

export function createAppleAuthRouter(): Router {
  const r = Router();
  attachRouteLogger(r, 'appleAuth');

  r.post('/start', 
    authRateLimits.general,
    async (req, res) => {
      const { device_id } = req.body || {};
      logger.info('[apple/start] request received', { deviceId: device_id });
      if (!device_id) {
        logger.warn('[apple/start] missing device_id');
        return res.status(400).json({ error: 'invalid_request' });
      }
      
      const id = uuidv4();
      logger.debug('[apple/start] generated handshake id', { id });
      await setJson(`als:${id}`, { device_id }, 600);
      logger.debug('[apple/start] temporary session stored', { id });
      
      // Generate Apple client secret (JWT)
      logger.debug('[apple/start] generating Apple client secret');
      const clientSecret = generateAppleClientSecret();
      
      const params = new URLSearchParams({
        client_id: config.apple.clientId,
        redirect_uri: config.apple.redirectUri,
        response_type: 'code',
        scope: 'name email',
        state: id,
        response_mode: 'form_post',
      });
      
      const responsePayload = { 
        url: `https://appleid.apple.com/auth/authorize?${params}`,
        clientSecret 
      };
      logger.info('[apple/start] returning Apple authorize url', { id });
      return res.json(responsePayload);
    }
  );

  r.get('/status/:id', async (req, res) => {
    logger.debug('[apple/status] polling status', { id: req.params.id });
    const session = await getJson<any>(`als:${req.params.id}`);
    if (!session) {
      logger.debug('[apple/status] session not ready', { id: req.params.id });
      return res.json({ ready: false });
    }
    logger.debug('[apple/status] session ready', { id: req.params.id });
    return res.json(session);
  });

  r.post('/callback', 
    authRateLimits.general,
    async (req, res) => {
      const { code, state, user } = req.body;
      logger.info('[apple/callback] request received', { statePresent: !!state, codePresent: !!code });
      if (!code || !state) {
        logger.warn('[apple/callback] missing code or state');
        return res.status(400).send('Invalid request');
      }
      
      const session = await getJson<any>(`als:${state}`);
      logger.debug('[apple/callback] fetched session', { sessionFound: !!session });
      if (!session || !session.device_id) {
        logger.warn('[apple/callback] invalid state record', { state });
        return res.status(400).send('Invalid state');
      }
      
      try {
        // Exchange code for access token
        logger.debug('[apple/callback] exchanging code for tokens');
        const tokenResp = await axios.post(
          'https://appleid.apple.com/auth/token',
          new URLSearchParams({
            client_id: config.apple.clientId,
            client_secret: generateAppleClientSecret(),
            code,
            grant_type: 'authorization_code',
            redirect_uri: config.apple.redirectUri,
          }),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        
        const { access_token, id_token } = (tokenResp.data as any);
        logger.debug('[apple/callback] token exchange success', { hasAccessToken: !!access_token, hasIdToken: !!id_token });
        
        // Decode ID token to get user info
        const decodedToken = jwt.decode(id_token) as any;
        const email = decodedToken?.email;
        const name = user?.name ? `${user.name.firstName} ${user.name.lastName}` : '';
        
        if (!email) {
          logger.warn('[apple/callback] missing email in decoded token');
          return res.status(400).send('No email');
        }

        const ipAddress = (req as any).ip || (req as any).connection?.remoteAddress;
        const userAgent = (req as any).get('User-Agent');
        logger.debug('[apple/callback] resolved request metadata', { ipAddress, hasUserAgent: !!userAgent });

        // Check if user exists in our new auth system
        let userRecord = await UserService.findByEmail(email);
        logger.debug('[apple/callback] user lookup complete', { found: !!userRecord });
        
        if (!userRecord) {
          // Create new Apple user in our auth system
          userRecord = await UserService.createAppleUser(email, name);
          logger.info('[apple/callback] apple user created', { userId: userRecord.id });
        } else {
          // Update last login for existing user
          await UserService.updateUser(userRecord.id, {
            lastLoginAt: new Date(),
          });
          logger.info('[apple/callback] existing user lastLogin updated', { userId: userRecord.id });
        }

        // Create session using new session system
        const deviceInfo = {
          os: 'ios',
          model: 'unknown',
          appVersion: '1.0.0',
          platform: 'mobile',
        };

        const { session: newSession, tokens } = await SessionService.createSession(
          userRecord.id,
          deviceInfo,
          session.device_id,
          ipAddress,
          userAgent
        );
        logger.debug('[apple/callback] session created', { sessionId: newSession.id });

        // Log successful Apple auth
        await auditService.logAuthEvent('login', {
          userId: userRecord.id,
          sessionId: newSession.id,
          ipAddress,
          userAgent,
          deviceInfo,
          success: true,
        });

        let firebaseCustomToken: string | undefined;
        try {
          firebaseCustomToken = await admin.auth().createCustomToken(userRecord.id, {
            email: userRecord.email,
            provider: 'apple',
          });
          logger.debug('[apple/callback] firebase custom token issued', { userId: userRecord.id });
        } catch (error) {
          logger.warn('Failed to create Firebase custom token for Apple user', {
            error,
            userId: userRecord.id,
            operation: 'apple_custom_token',
          });
        }
        
        await setJson(`als:${state}`, {
          ready: true,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          sessionId: tokens.sessionId,
          user: {
            id: userRecord.id,
            email: userRecord.email,
            name: userRecord.name,
            avatar: userRecord.avatar,
          },
          deviceId: session.device_id,
          firebaseCustomToken,
          firebase_token: firebaseCustomToken ?? null,
        }, 600);
        logger.info('[apple/callback] session ready for polling', { state });
        
        return res.send('<html><body>Login successful. You may close this window.</body></html>');
      } catch (error) {
        logger.error({ err: error, operation: 'appleAuth' }, 'Apple auth error');
        logger.debug('[apple/callback] error details', { errorMessage: error instanceof Error ? error.message : 'unknown' });
        
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

function generateAppleClientSecret(): string {
  const now = Math.floor(Date.now() / 1000);
  
  const payload = {
    iss: config.apple.teamId,
    iat: now,
    exp: now + 3600, // 1 hour
    aud: 'https://appleid.apple.com',
    sub: config.apple.clientId,
  };

  const header = {
    alg: 'ES256',
    kid: config.apple.keyId,
  };

  return jwt.sign(payload, config.apple.privateKey, {
    algorithm: 'ES256',
    header,
  });
}

function base64url(b: Buffer | string): string {
  const raw = Buffer.isBuffer(b) ? b : Buffer.from(b);
  return raw.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
