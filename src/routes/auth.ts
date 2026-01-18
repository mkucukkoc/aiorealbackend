import { Router, Request, Response } from 'express';
import { UserService } from '../services/userService';
import { SessionService } from '../services/sessionService';
import { auditService } from '../services/auditService';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { validate, authSchemas } from '../middleware/validationMiddleware';
import { authRateLimits } from '../middleware/rateLimitMiddleware';
import { RegisterRequest, LoginRequest, RefreshRequest, LogoutRequest, AuthResponse, User } from '../types/auth';
import { StandardResponse, ResponseBuilder } from '../types/response';
import { admin, db } from '../firebase';
import { randomInt, createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { sendOtpEmail } from '../email';
import { getJson, setJson } from '../redis';
import { logger } from '../utils/logger';
import { attachRouteLogger } from '../utils/routeLogger';
import { config } from '../config';
import { cleanupDeletedAccountArtifacts, ensureFirebaseAuthUserProfile, restoreSoftDeletedUser } from '../services/reactivationService';

export function createAuthRouter(): Router {
  const r = Router();
  attachRouteLogger(r, 'auth');
  const isSoftDeletedUser = (user: any) =>
    Boolean(user && (user.isDeleted === true || user.is_deleted === true));
  const normalizeEmailInput = (value: any): string =>
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  const sanitizeDocId = (value: string): string => value.replace(/\//g, '_');
  const getRegisterOtpRef = (email: string) =>
    db.collection('registerOtpCodes').doc(sanitizeDocId(normalizeEmailInput(email)));
  const getPasswordResetOtpRef = (userId: string) =>
    db.collection('passwordResetOtpCodes').doc(userId);
  const toDateSafe = (input: any): Date => {
    if (!input) {
      return new Date(0);
    }
    if (typeof input.toDate === 'function') {
      return input.toDate();
    }
    return input instanceof Date ? input : new Date(input);
  };

  // POST /auth/register
  r.post('/register', 
    authRateLimits.register,
    validate(authSchemas.register),
    async (req, res) => {
      try {
        const { email, password, device, deviceId, name }: RegisterRequest = req.body;
        const ipAddress = (req as any).ip || (req as any).connection?.remoteAddress;
        const userAgent = (req as any).get('User-Agent');
        logger.info(
          { email, deviceId, device, name, ipAddress },
          'Registration request payload'
        );

        // Check if email is already registered
        let existingUser = await UserService.findByEmail(email);
        if (existingUser) {
          const userRecord = existingUser;
          const isGoogleAccount = userRecord.provider === 'google' || (!userRecord.provider && !userRecord.passwordHash);
          const errorCode = isGoogleAccount ? 'google_account_exists' : 'email_already_registered';
          const errorMessage = isGoogleAccount
            ? "This email is registered with a Google account. Please use 'Sign in with Google'."
            : 'An account with this email already exists';

          const wasSoftDeleted = !isGoogleAccount && ((userRecord as any).isDeleted || (userRecord as any).is_deleted);
          if (wasSoftDeleted) {
            logger.info({ email, userId: userRecord.id }, 'Soft-deleted account matched during registration; restoring existing user');
            await restoreSoftDeletedUser(userRecord.id);

            if (password) {
              await UserService.updatePassword(userRecord.id, password);
            }

            const profileUpdates: Partial<User> = {};
            if (name && name !== userRecord.name) {
              profileUpdates.name = name;
            }
            if (Object.keys(profileUpdates).length > 0) {
              await UserService.updateUser(userRecord.id, profileUpdates);
            }

            const reactivatedUser = {
              ...userRecord,
              ...profileUpdates,
              isDeleted: false,
              is_deleted: false,
              deletedAt: null,
              premiumCancelledAt: null,
            } as any;
            existingUser = reactivatedUser;

            await UserService.resetFailedAttempts(userRecord.id);
            logger.info({ email, userId: userRecord.id }, 'Soft-deleted account restored and ready for new session');

            const { session, tokens } = await SessionService.createSession(
              userRecord.id,
              device,
              deviceId,
              ipAddress,
              userAgent
            );

            await auditService.logAuthEvent('register', {
              userId: userRecord.id,
              sessionId: session.id,
              ipAddress,
              userAgent,
              deviceInfo: device,
              success: true,
              reactivated: true,
            });

            logger.info({ userId: userRecord.id }, 'Soft-deleted email/password user reactivated, cleaning artifacts');
            await cleanupDeletedAccountArtifacts(userRecord.id);
            await ensureFirebaseAuthUserProfile(reactivatedUser.id, {
              email: reactivatedUser.email,
              name: reactivatedUser.name,
            });

            let firebaseCustomToken: string | undefined;
            try {
              firebaseCustomToken = await admin.auth().createCustomToken(reactivatedUser.id, {
                email: reactivatedUser.email,
                provider: reactivatedUser.provider ?? 'password',
              });
            } catch (error) {
              logger.warn({ error, userId: reactivatedUser.id, operation: 'register_reactivate' }, 'Failed to create Firebase custom token');
            }

            const response: AuthResponse = {
              ...tokens,
              user: {
                id: reactivatedUser.id,
                email: reactivatedUser.email,
                name: reactivatedUser.name,
                avatar: reactivatedUser.avatar,
              },
              deviceId,
              firebaseCustomToken,
            };

            return res
              .status(200)
              .json(
                ResponseBuilder.success(response, 'Existing account restored and signed in')
              );
          }

          await auditService.logAuthEvent('register', {
            ipAddress,
            userAgent,
            deviceInfo: device,
            success: false,
            errorMessage,
          });
          return res.status(409).json({
            error: errorCode,
            message: errorMessage,
          });
        }

        // Create user
        const user = await UserService.createUser({ email, password, device, deviceId, name });
        logger.info({ userId: user.id, email }, 'New user registered via email verification flow');
        logger.info({ userId: user.id, email }, 'New user registered via email/password');

        // Create session
        const { session, tokens } = await SessionService.createSession(
          user.id,
          device,
          deviceId,
          ipAddress,
          userAgent
        );

        // Log successful registration
        await auditService.logAuthEvent('register', {
          userId: user.id,
          sessionId: session.id,
          ipAddress,
          userAgent,
          deviceInfo: device,
          success: true,
        });

        let firebaseCustomToken: string | undefined;
        try {
          firebaseCustomToken = await admin.auth().createCustomToken(user.id, {
            email: user.email,
            provider: user.provider ?? 'password',
          });
        } catch (error) {
          logger.warn({ error, userId: user.id, operation: 'register' }, 'Failed to create Firebase custom token');
        }

        const response: AuthResponse = {
          ...tokens,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatar: user.avatar,
          },
          deviceId,
          firebaseCustomToken,
        };
        logger.debug({ email, userId: user.id, response }, 'Registration response payload');

        res.status(201).json(ResponseBuilder.success(response, 'User registered successfully'));
      } catch (error) {
        logger.error({ err: error, email: req.body.email, operation: 'register' }, 'Registration error');
        res.status(500).json(ResponseBuilder.error(
          'internal_error',
          'Registration failed'
        ));
      }
    }
  );

  // POST /auth/password/reset/complete
  r.post('/password/reset/complete',
    authRateLimits.register,
    async (req, res) => {
      try {
        const { email: rawEmail, token, password } = req.body || {};
        const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
        if (!email || !token || !password) {
          return res.status(400).json({
            error: 'invalid_request',
            message: 'Email, token, and password are required',
          });
        }

        const tokenHash = sha256(token);
        const tokenSnap = await db
          .collection('passwordResetTokens')
          .where('email', '==', email)
          .where('tokenHash', '==', tokenHash)
          .limit(1)
          .get();

        if (tokenSnap.empty) {
          return res.status(400).json({
            error: 'invalid_reset_token',
            message: 'Invalid or expired reset token',
          });
        }

        const tokenDoc = tokenSnap.docs[0];
        const tokenData = tokenDoc.data() as any;
        const tokenExpires: Date =
          tokenData.expiresAt?.toDate?.() ?? tokenData.expiresAt ?? new Date(0);
        if (tokenExpires.getTime() < Date.now()) {
          await tokenDoc.ref.delete();
          return res.status(400).json({
            error: 'invalid_reset_token',
            message: 'Reset token has expired',
          });
        }

        const user = await UserService.findByEmail(email);
        if (!user) {
          await tokenDoc.ref.delete();
          return res.status(404).json({
            error: 'user_not_found',
            message: 'User not found',
          });
        }

        if (isSoftDeletedUser(user)) {
          await tokenDoc.ref.delete();
          return res.status(423).json({
            error: 'account_deleted',
            message: 'This account has been deleted. Please register again.',
          });
        }

        await UserService.updatePassword(user.id, password);
        await tokenDoc.ref.delete();

        logger.info({ userId: user.id, email }, 'Password reset completed successfully');
        res.json({
          success: true,
          message: 'Password reset successful',
        });
      } catch (error) {
        logger.error('Password reset completion error:', error);
        res.status(500).json({
          error: 'internal_error',
          message: 'Failed to reset password',
        });
      }
    }
  );

  // POST /auth/password/reset/verify
  r.post('/password/reset/verify',
    authRateLimits.register,
    async (req, res) => {
      try {
        const rawEmail = req.body?.email;
        const otp = req.body?.otp;
        const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
        if (!email || !otp) {
          return res.status(400).json({
            error: 'invalid_request',
            message: 'Email and OTP are required',
          });
        }

        const user = await UserService.findByEmail(email);
        if (!user) {
          return res.status(400).json({
            error: 'invalid_reset_code',
            message: 'Invalid or expired verification code',
          });
        }

        const otpDoc = await getPasswordResetOtpRef(user.id).get();
        if (!otpDoc.exists) {
          return res.status(400).json({
            error: 'invalid_reset_code',
            message: 'Invalid or expired verification code',
          });
        }

        const record = otpDoc.data() as any;
        const expiresAt = toDateSafe(record.expiresAt);
        if (expiresAt.getTime() < Date.now()) {
          await otpDoc.ref.delete();
          return res.status(400).json({
            error: 'invalid_reset_code',
            message: 'Verification code has expired',
          });
        }

        const isMatch = record.codeHash === sha256(otp);
        if (!isMatch) {
          return res.status(400).json({
            error: 'invalid_reset_code',
            message: 'Invalid verification code',
          });
        }

        await otpDoc.ref.delete();

        const resetToken = uuidv4();
        const resetTokenHash = sha256(resetToken);
        await db.collection('passwordResetTokens').add({
          email,
          userId: user.id,
          tokenHash: resetTokenHash,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        });

        logger.info({ email, userId: user.id }, 'Password reset token issued after code verification');
        res.json({
          success: true,
          token: resetToken,
        });
      } catch (error) {
        logger.error('Password reset verify error:', error);
        res.status(500).json({
          error: 'internal_error',
          message: 'Failed to verify password reset code',
        });
      }
    }
  );

  // POST /auth/password/reset/start
  r.post('/password/reset/start',
    authRateLimits.register,
    async (req, res) => {
      try {
        const rawEmail = req.body?.email;
        const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
        if (!email) {
          return res.status(400).json({
            error: 'invalid_request',
            message: 'Email is required',
          });
        }

        const user = await UserService.findByEmail(email);
        if (!user) {
          return res.status(404).json({
            error: 'user_not_found',
            message: 'User not found',
          });
        }

        if (isSoftDeletedUser(user)) {
          return res.status(423).json({
            error: 'account_deleted',
            message: 'This account has been deleted. Please register again.',
          });
        }

        const isGoogleAccount =
          user.provider === 'google' || (!user.provider && !user.passwordHash);
        if (isGoogleAccount) {
          return res.status(409).json({
            error: 'google_account_exists',
            message: "This email is registered with a Google account. Please use 'Sign in with Google'.",
          });
        }

        const rlKey = `pwd_reset_otp:rl:${email}`;
        const rl = (await getJson<{ count: number }>(rlKey)) || { count: 0 };
        if (rl.count >= 5) {
          return res.status(429).json({
            error: 'rate_limited',
            message: 'Too many password reset attempts. Please try again later.',
          });
        }
        rl.count += 1;
        await setJson(rlKey, rl, 600);

        const code = (randomInt(0, 999999) + '').padStart(6, '0');
        const codeHash = sha256(code);
        await getPasswordResetOtpRef(user.id).set(
          {
            email,
            codeHash,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
            userId: user.id,
          },
          { merge: true }
        );

        try {
          await sendOtpEmail(email, code);
        } catch (emailError) {
          logger.error('Failed to send password reset email:', emailError);
        }

        logger.info({ email, userId: user.id }, 'Password reset code generated and sent');
        res.json({
          success: true,
          message: 'Verification code sent to your email',
        });
      } catch (error) {
        logger.error('Password reset start error:', error);
        res.status(500).json({
          error: 'internal_error',
          message: 'Failed to send password reset code',
        });
      }
    }
  );

  // POST /auth/login
  r.post('/login',
    authRateLimits.login,
    validate(authSchemas.login),
    async (req, res) => {
      try {
        const { email, password, device, deviceId }: LoginRequest = req.body;
        const ipAddress = (req as any).ip || (req as any).connection?.remoteAddress;
        const userAgent = (req as any).get('User-Agent');
        logger.info(
          { email, deviceId, device, ipAddress },
          'Login request payload'
        );

        const foundUser = await UserService.findByEmail(email);
        if (!foundUser) {
          await auditService.logAuthEvent('login', {
            ipAddress,
            userAgent,
            deviceInfo: device,
            success: false,
            errorMessage: 'User not found',
          });
          return res.status(401).json({
            error: 'invalid_credentials',
            message: 'Invalid email or password'
          });
        }

        let user = foundUser;
        const isSoftDeleted = (user as any).isDeleted || (user as any).is_deleted;
        if (isSoftDeleted) {
          await auditService.logAuthEvent('login', {
            userId: user.id,
            ipAddress,
            userAgent,
            deviceInfo: device,
            success: false,
            errorMessage: 'Account deleted, registration required',
          });
          return res.status(404).json({
            error: 'account_deleted',
            message: 'Hesabınız silinmiş. Lütfen yeniden kayıt olun.',
          });
        }

        const isGoogleAccount = user.provider === 'google' || (!user.provider && !user.passwordHash);
        if (isGoogleAccount) {
          const errorMessage = "Bu e-posta Google hesabı ile kayıtlı, lütfen 'Google ile giriş yap' seçeneğini kullanın.";
          await auditService.logAuthEvent('login', {
            userId: user.id,
            ipAddress,
            userAgent,
            deviceInfo: device,
            success: false,
            errorMessage,
          });
          return res.status(409).json({
            error: 'google_account_exists',
            message: errorMessage,
          });
        }

        // Check if user is locked
        if (UserService.isUserLocked(user)) {
          await auditService.logAuthEvent('login', {
            userId: user.id,
            ipAddress,
            userAgent,
            deviceInfo: device,
            success: false,
            errorMessage: 'Account locked',
          });
          return res.status(423).json({ 
            error: 'account_locked',
            message: 'Account is temporarily locked due to too many failed attempts' 
          });
        }

        // Verify password
        const isValidPassword = await UserService.verifyPassword(user, password);
        if (!isValidPassword) {
          await UserService.incrementFailedAttempts(user.id);
          await auditService.logAuthEvent('login', {
            userId: user.id,
            ipAddress,
            userAgent,
            deviceInfo: device,
            success: false,
            errorMessage: 'Invalid password',
          });
          return res.status(401).json({ 
            error: 'invalid_credentials',
            message: 'Invalid email or password' 
          });
        }

        // Reset failed attempts on successful login
        await UserService.resetFailedAttempts(user.id);

        // Verify Firebase authentication user exists
        try {
          const firebaseUser = await admin.auth().getUser(user.id);
          logger.info({ userId: firebaseUser.uid, email: firebaseUser.email, operation: 'firebaseVerification' }, 'Firebase user verified for login');
        } catch (error) {
          logger.warn({ err: error, userId: user.id, operation: 'firebaseVerification' }, 'Firebase user verification failed during login');
          // Continue with login even if Firebase verification fails
        }

        // Create session
        const { session, tokens } = await SessionService.createSession(
          user.id,
          device,
          deviceId,
          ipAddress,
          userAgent
        );

        // Log successful login
        await auditService.logAuthEvent('login', {
          userId: user.id,
          sessionId: session.id,
          ipAddress,
          userAgent,
          deviceInfo: device,
          success: true,
        });

        let firebaseCustomToken: string | undefined;
        try {
          firebaseCustomToken = await admin.auth().createCustomToken(user.id, {
            email: user.email,
            provider: user.provider ?? 'password',
          });
        } catch (error) {
          logger.warn({ error, userId: user.id, operation: 'login' }, 'Failed to create Firebase custom token');
        }

        const response: AuthResponse = {
          ...tokens,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatar: user.avatar,
          },
          deviceId,
          firebaseCustomToken,
        };
        logger.debug({ userId: user.id, response }, 'Login response payload');

        res.json(response);
      } catch (error) {
        logger.error({ err: error, email: req.body.email, operation: 'login' }, 'Login error');
        res.status(500).json({ 
          error: 'internal_error',
          message: 'Login failed' 
        });
      }
    }
  );

  // POST /auth/refresh
  r.post('/refresh',
    authRateLimits.refresh,
    validate(authSchemas.refresh),
    async (req, res) => {
      try {
        const { refreshToken, sessionId, deviceId }: RefreshRequest = req.body;
        const ipAddress = (req as any).ip || (req as any).connection?.remoteAddress;
        const userAgent = (req as any).get('User-Agent');
        logger.info({ sessionId, deviceId, ipAddress }, 'Token refresh request payload');

        try {
          const result = await SessionService.verifyAndRotateRefreshToken(
            sessionId,
            refreshToken,
            deviceId
          );

          if (!result) {
            await auditService.logAuthEvent('refresh', {
              sessionId,
              ipAddress,
              userAgent,
              success: false,
              errorMessage: 'Invalid session or token',
            });
            return res.status(401).json({ 
              error: 'invalid_refresh_token',
              message: 'Invalid or expired refresh token' 
            });
          }

          // Log successful refresh
          await auditService.logAuthEvent('refresh', {
            userId: result.session.userId,
            sessionId: result.session.id,
            ipAddress,
            userAgent,
            success: true,
          });

          res.json(result.tokens);
          logger.debug({ sessionId, tokens: result.tokens }, 'Token refresh response payload');
        } catch (error: any) {
          if (error.message === 'REUSE_DETECTED') {
            await auditService.logAuthEvent('reuse_detected', {
              sessionId,
              ipAddress,
              userAgent,
              success: false,
              errorMessage: 'Refresh token reuse detected',
            });
            return res.status(401).json({ 
              error: 'token_reuse_detected',
              message: 'Security violation detected. All sessions have been revoked.' 
            });
          }
          throw error;
        }
      } catch (error) {
        logger.error({ err: error, operation: 'refresh' }, 'Refresh error');
        res.status(500).json({ 
          error: 'internal_error',
          message: 'Token refresh failed' 
        });
      }
    }
  );

  // POST /auth/firebase-token
  r.post(
    '/firebase-token',
    authRateLimits.general,
    authenticateToken,
    async (req: Request, res: Response) => {
      const authReq = req as AuthRequest;
      const user = authReq.user;

      if (!user?.id) {
        return res.status(401).json(
          ResponseBuilder.error(
            'unauthorized',
            'Authentication required to request Firebase token'
          )
        );
      }

      try {
        const firebaseCustomToken = await admin.auth().createCustomToken(user.id, {
          email: user.email,
        });

        return res.json(
          ResponseBuilder.success(
            { firebaseCustomToken },
            'Firebase custom token generated successfully'
          )
        );
      } catch (error) {
        logger.error(
          { err: error, userId: user.id, operation: 'firebaseCustomToken' },
          'Failed to create Firebase custom token'
        );

        return res.status(500).json(
          ResponseBuilder.error(
            'firebase_token_creation_failed',
            'Failed to generate Firebase custom token'
          )
        );
      }
    }
  );

  // POST /auth/logout
  r.post('/logout',
    authRateLimits.general,
    validate(authSchemas.logout),
    async (req, res) => {
      try {
        const { sessionId }: LogoutRequest = req.body;
        const ipAddress = (req as any).ip || (req as any).connection?.remoteAddress;
        const userAgent = (req as any).get('User-Agent');

        const success = await SessionService.revokeSession(sessionId);

        if (success) {
          await auditService.logAuthEvent('logout', {
            sessionId,
            ipAddress,
            userAgent,
            success: true,
          });
        }

        const responsePayload = { success };
        logger.debug({ sessionId, response: responsePayload }, 'Logout response payload');
        res.json(responsePayload);
      } catch (error) {
        logger.error('Logout error:', error);
        res.status(500).json({ 
          error: 'internal_error',
          message: 'Logout failed' 
        });
      }
    }
  );

  // POST /auth/logout-all
  r.post('/logout-all',
    authRateLimits.general,
    authenticateToken,
    async (req: Request, res: Response) => {
      const authReq = req as unknown as AuthRequest;
      try {
        const ipAddress = (req as any).ip || (req as any).connection?.remoteAddress;
        const userAgent = (req as any).get('User-Agent');
        logger.info({ userId: authReq.user?.id, ipAddress, userAgent }, 'Logout all request payload');

        await SessionService.revokeAllUserSessions(authReq.user!.id);

        await auditService.logAuthEvent('logout_all', {
          userId: authReq.user!.id,
          ipAddress,
          userAgent,
          success: true,
        });

        const responsePayload = { success: true };
        logger.debug({ userId: authReq.user!.id, response: responsePayload }, 'Logout all response payload');

        res.json(responsePayload);
      } catch (error) {
        logger.error('Logout all error:', error);
        res.status(500).json({ 
          error: 'internal_error',
          message: 'Logout failed' 
        });
      }
    }
  );

  // GET /auth/me
  r.get('/me',
    authenticateToken,
    async (req: Request, res: Response) => {
      const authReq = req as unknown as AuthRequest;
      try {
        logger.info({ userId: authReq.user?.id }, 'Get current user payload');
        const user = await UserService.findById(authReq.user!.id);
        if (!user) {
          return res.status(404).json({ 
            error: 'user_not_found',
            message: 'User not found' 
          });
        }

        const response = {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar: user.avatar,
          isEmailVerified: user.isEmailVerified,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
        };
        logger.debug({ userId: user.id, response }, 'Get current user response payload');
        res.json(response);
      } catch (error) {
        logger.error('Get user error:', error);
        res.status(500).json({ 
          error: 'internal_error',
          message: 'Failed to get user information' 
        });
      }
    }
  );

  // POST /auth/register/email/start - Send verification code for registration
  r.post('/register/email/start', 
    authRateLimits.register,
    async (req, res) => {
      try {
        const email = normalizeEmailInput(req.body?.email);
        if (!email) {
          return res.status(400).json({ 
            error: 'invalid_request',
            message: 'Email is required' 
          });
        }

        // Check if email is already registered
        const existingUserAfterOtp = await UserService.findByEmail(email);
        const isSoftDeleted = isSoftDeletedUser(existingUserAfterOtp);
        if (existingUserAfterOtp && !isSoftDeleted) {
          const isGoogleAccount = existingUserAfterOtp.provider === 'google' || (!existingUserAfterOtp.provider && !existingUserAfterOtp.passwordHash);
          const errorCode = isGoogleAccount ? 'google_account_exists' : 'email_already_registered';
          const errorMessage = isGoogleAccount
            ? "Bu e-posta Google hesabı ile kayıtlı, lütfen 'Google ile giriş yap' seçeneğini kullanın."
            : 'An account with this email already exists';
          return res.status(409).json({
            error: errorCode,
            message: errorMessage
          });
        }

        // Rate limiting for email sending
        const key = `register_otp:rl:${email}`;
        const rl = (await getJson<{ count: number }>(key)) || { count: 0 };
        if (rl.count >= 5) {
          return res.status(429).json({ 
            error: 'rate_limited',
            message: 'Too many verification attempts. Please try again later.' 
          });
        }
        rl.count += 1;
        await setJson(key, rl, 600); // 10 minutes

        // Generate and store OTP
        const code = (randomInt(0, 999999) + '').padStart(6, '0');
        const codeHash = sha256(code);
        await getRegisterOtpRef(email).set(
          { 
            email, 
            codeHash, 
            expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
            createdAt: new Date() 
          },
          { merge: true }
        );

        // Send email
        try {
          await sendOtpEmail(email, code);
        } catch (emailError) {
          logger.error('Failed to send verification email:', emailError);
          // Don't fail the request if email sending fails
        }

        res.json({ 
          success: true,
          message: 'Verification code sent to your email' 
        });
      } catch (error) {
        logger.error('Send registration OTP error:', error);
        res.status(500).json({ 
          error: 'internal_error',
          message: 'Failed to send verification code' 
        });
      }
    }
  );

  // POST /auth/register/email/verify - Verify code and complete registration
  r.post('/register/email/verify',
    authRateLimits.register,
    async (req, res) => {
      try {
        const email = normalizeEmailInput(req.body?.email);
        const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
        const password = req.body?.password;
        const name = req.body?.name;
        const device = req.body?.device;
        const deviceId = req.body?.deviceId;
        
        if (!email || !otp || !password || !device || !deviceId) {
          return res.status(400).json({ 
            error: 'invalid_request',
            message: 'Email, OTP, password, device, and deviceId are required' 
          });
        }

        // Verify OTP - Get all records for email and sort in memory
        const otpDoc = await getRegisterOtpRef(email).get();

        if (!otpDoc.exists) {
          return res.status(400).json({ 
            error: 'invalid_otp',
            message: 'Invalid or expired verification code' 
          });
        }

        const record = otpDoc.data() as any;
        
        if (toDateSafe(record.expiresAt).getTime() < Date.now()) {
          await otpDoc.ref.delete(); // Clean up expired code
          return res.status(400).json({ 
            error: 'invalid_otp',
            message: 'Verification code has expired' 
          });
        }

        const isMatch = record.codeHash === sha256(otp);
        if (!isMatch) {
          return res.status(400).json({ 
            error: 'invalid_otp',
            message: 'Invalid verification code' 
          });
        }

        // Clean up the OTP code
        await otpDoc.ref.delete();

        // Check if email is still available (double-check)
        const existingUser = await UserService.findByEmail(email);
        const isSoftDeleted = isSoftDeletedUser(existingUser);
        let user: User;

        if (existingUser) {
          const isGoogleAccount =
            existingUser.provider === 'google' || (!existingUser.provider && !existingUser.passwordHash);
          if (isGoogleAccount) {
            return res.status(409).json({
              error: 'google_account_exists',
              message: "Bu e-posta Google hesabı ile kayıtlı, lütfen 'Google ile giriş yap' seçeneğini kullanın.",
            });
          }

          if (!isSoftDeleted) {
            return res.status(409).json({
              error: 'email_already_registered',
              message: 'An account with this email already exists',
            });
          }

          logger.info({ email, userId: existingUser.id }, 'Soft-deleted account matched during email verification; restoring existing user');
          await restoreSoftDeletedUser(existingUser.id);

          if (password) {
            await UserService.updatePassword(existingUser.id, password);
          }

          const profileUpdates: Partial<User> = {};
          if (name && name !== existingUser.name) {
            profileUpdates.name = name;
          }

          if (Object.keys(profileUpdates).length > 0) {
            await UserService.updateUser(existingUser.id, profileUpdates);
          }

          user = {
            ...existingUser,
            ...profileUpdates,
            isDeleted: false,
            is_deleted: false,
            deletedAt: null,
            premiumCancelledAt: null,
          } as User;

          await UserService.resetFailedAttempts(existingUser.id);
          logger.info({ email, userId: existingUser.id }, 'Soft-deleted account restored via email verification flow');
        } else {
          user = await UserService.createUser({ email, password, device, deviceId, name });
          logger.info({ userId: user.id, email }, 'New user registered via email verification flow');
        }

        // Create session
        const ipAddress = (req as any).ip || (req as any).connection?.remoteAddress;
        const userAgent = (req as any).get('User-Agent');
        const { session, tokens } = await SessionService.createSession(
          user.id,
          device,
          deviceId,
          ipAddress,
          userAgent
        );

        // Log successful registration
        await auditService.logAuthEvent('register', {
          userId: user.id,
          sessionId: session.id,
          ipAddress,
          userAgent,
          deviceInfo: device,
          success: true,
        });

        let firebaseCustomToken: string | undefined;
        try {
          firebaseCustomToken = await admin.auth().createCustomToken(user.id, {
            email: user.email,
            provider: user.provider ?? 'password',
          });
        } catch (error) {
          logger.warn({ error, userId: user.id, operation: 'register_verify' }, 'Failed to create Firebase custom token');
        }

        const response: AuthResponse = {
          ...tokens,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatar: user.avatar,
          },
          deviceId,
          firebaseCustomToken,
        };

        res.status(201).json(response);
      } catch (error) {
        logger.error('Verify registration OTP error:', error);
        res.status(500).json({ 
          error: 'internal_error',
          message: 'Registration verification failed' 
        });
      }
    }
  );

  // Google OAuth endpoint
  r.post('/google', 
    authRateLimits.general,
    async (req, res) => {
      try {
        const { idToken, email, name, photo } = req.body;
        
        if (!idToken || !email) {
          return res.status(400).json({ 
            error: 'invalid_request',
            message: 'Missing required fields: idToken and email' 
          });
        }

        // Verify Google ID token
        const { OAuth2Client } = require('google-auth-library');
        const client = new OAuth2Client(config.google.clientId);
        
        let ticket;
        try {
          ticket = await client.verifyIdToken({
            idToken,
            audience: config.google.clientId,
          });
        } catch (error) {
          logger.error('Google ID token verification failed:', error);
          return res.status(401).json({ 
            error: 'invalid_token',
            message: 'Invalid Google ID token' 
          });
        }

        const payload = ticket.getPayload();
        if (!payload || payload.email !== email) {
          return res.status(401).json({ 
            error: 'invalid_token',
            message: 'Token email does not match provided email' 
          });
        }

        const ipAddress = (req as any).ip || (req as any).connection?.remoteAddress;
        const userAgent = (req as any).get('User-Agent');

        // Check if user exists
        let user = await UserService.findByEmail(email);
        let wasSoftDeleted = false;
        if (!user) {
          user = await UserService.createGoogleUser(
            email,
            name || payload.name || payload.given_name || ''
          );

          logger.info('Google user created successfully', {
            userId: user.id,
            email: user.email,
            operation: 'google_oauth'
          });
        } else {
          const existingUser = user;
          if ((existingUser as any).isDeleted || (existingUser as any).is_deleted) {
            wasSoftDeleted = true;
            await restoreSoftDeletedUser(existingUser.id);
            user = {
              ...existingUser,
              isDeleted: false,
              is_deleted: false,
              deletedAt: null,
              premiumCancelledAt: null,
            } as any;
          }

          // Update last login for existing user
          await UserService.updateUser(existingUser.id, {
            lastLoginAt: new Date(),
          });
          
          // Also update Firebase Auth user if needed
          try {
            await admin.auth().updateUser(existingUser.id, {
              displayName: name || payload.name || payload.given_name || existingUser.name,
              emailVerified: true,
            });
          } catch (error) {
            logger.warn('Failed to update Firebase Auth user', { error, userId: existingUser.id });
          }
        }

        const ensuredUser = user!;

        // Create session
        const deviceInfo = {
          os: 'mobile',
          model: 'unknown',
          appVersion: '1.0.0',
          platform: 'mobile',
        };

        const { session, tokens } = await SessionService.createSession(
          ensuredUser.id,
          deviceInfo,
          'google-auth-device', // Device ID for Google auth
          ipAddress,
          userAgent
        );

        // Log successful Google auth
        await auditService.logAuthEvent('login', {
          userId: ensuredUser.id,
          sessionId: session.id,
          ipAddress,
          userAgent,
          deviceInfo,
          success: true,
        });

        if (wasSoftDeleted) {
          logger.info({ userId: ensuredUser.id }, 'Soft-deleted Google user reactivated, cleaning artifacts');
          await cleanupDeletedAccountArtifacts(ensuredUser.id);
        }

        let firebaseCustomToken: string | undefined;
        try {
          firebaseCustomToken = await admin.auth().createCustomToken(ensuredUser.id, {
            email: ensuredUser.email,
            provider: 'google',
          });
        } catch (error) {
          logger.warn({ error, userId: ensuredUser.id, operation: 'google_direct' }, 'Failed to create Firebase custom token');
        }

        const response: AuthResponse = {
          ...tokens,
          user: {
            id: ensuredUser.id,
            email: ensuredUser.email,
            name: ensuredUser.name,
            avatar: ensuredUser.avatar,
          },
          deviceId: 'google-auth-device',
          firebaseCustomToken,
        };

        res.json(response);
      } catch (error) {
        logger.error('Google auth error:', error);
        res.status(500).json({ 
          error: 'internal_error',
          message: 'Google authentication failed' 
        });
      }
    }
  );

  // Test Firebase connection endpoint
  r.get('/test-firebase', async (req, res) => {
    try {
      // Test Firestore connection
      const testDoc = await db.collection('test').doc('connection').set({
        timestamp: new Date(),
        message: 'Firebase connection test'
      });
      
      // Test Firebase Auth
      const testUser = await admin.auth().createUser({
        uid: 'test-user-' + Date.now(),
        email: 'test@example.com',
        displayName: 'Test User',
        emailVerified: false
      });
      
      // Clean up test user
      await admin.auth().deleteUser(testUser.uid);
      
      res.json({
        success: true,
        message: 'Firebase connection successful',
        firestore: 'Connected',
        auth: 'Connected',
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('Firebase test error:', error);
      res.status(500).json({
        success: false,
        message: 'Firebase connection failed',
        error: error.message || 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  return r;
}

// Helper functions
function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}



