import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { HashService } from '../src/services/hashService';
import { UserService } from '../src/services/userService';
import { SessionService } from '../src/services/sessionService';
import { TokenService } from '../src/services/tokenService';
import { PasswordResetService } from '../src/services/passwordResetService';
import { db } from '../src/firebase';

describe('Services', () => {
  const testUser = {
    email: 'test@example.com',
    password: 'TestPassword123',
    name: 'Test User',
    device: {
      os: 'iOS',
      model: 'iPhone 13',
      appVersion: '1.0.0',
      platform: 'mobile',
    },
    deviceId: 'test-device-123',
  };

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  describe('HashService', () => {
    it('should hash and verify passwords correctly', async () => {
      const password = 'TestPassword123';
      const hash = await HashService.hashPassword(password);
      
      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      
      const isValid = await HashService.verifyPassword(password, hash);
      expect(isValid).toBe(true);
      
      const isInvalid = await HashService.verifyPassword('wrongpassword', hash);
      expect(isInvalid).toBe(false);
    });

    it('should hash and verify refresh tokens correctly', async () => {
      const token = 'test-refresh-token';
      const hash = await HashService.hashRefreshToken(token);
      
      expect(hash).toBeDefined();
      expect(hash).not.toBe(token);
      
      const isValid = await HashService.verifyRefreshToken(token, hash);
      expect(isValid).toBe(true);
      
      const isInvalid = await HashService.verifyRefreshToken('wrong-token', hash);
      expect(isInvalid).toBe(false);
    });
  });

  describe('UserService', () => {
    it('should create user successfully', async () => {
      const user = await UserService.createUser(testUser);
      
      expect(user).toBeDefined();
      expect(user.id).toBeDefined();
      expect(user.email).toBe(testUser.email.toLowerCase());
      expect(user.name).toBe(testUser.name);
      expect(user.passwordHash).toBeDefined();
      expect(user.passwordHash).not.toBe(testUser.password);
      expect(user.isEmailVerified).toBe(false);
      expect(user.failedLoginAttempts).toBe(0);
    });

    it('should find user by email', async () => {
      const createdUser = await UserService.createUser(testUser);
      const foundUser = await UserService.findByEmail(testUser.email);
      
      expect(foundUser).toBeDefined();
      expect(foundUser?.id).toBe(createdUser.id);
      expect(foundUser?.email).toBe(testUser.email.toLowerCase());
    });

    it('should return null for non-existent email', async () => {
      const foundUser = await UserService.findByEmail('nonexistent@example.com');
      expect(foundUser).toBeNull();
    });

    it('should verify password correctly', async () => {
      const user = await UserService.createUser(testUser);
      const isValid = await UserService.verifyPassword(user, testUser.password);
      const isInvalid = await UserService.verifyPassword(user, 'wrongpassword');
      
      expect(isValid).toBe(true);
      expect(isInvalid).toBe(false);
    });

    it('should check if email is registered', async () => {
      expect(await UserService.isEmailRegistered(testUser.email)).toBe(false);
      
      await UserService.createUser(testUser);
      
      expect(await UserService.isEmailRegistered(testUser.email)).toBe(true);
    });

    it('should increment failed attempts and lock account', async () => {
      const user = await UserService.createUser(testUser);
      
      // Increment failed attempts
      await UserService.incrementFailedAttempts(user.id);
      await UserService.incrementFailedAttempts(user.id);
      await UserService.incrementFailedAttempts(user.id);
      await UserService.incrementFailedAttempts(user.id);
      await UserService.incrementFailedAttempts(user.id);
      
      const updatedUser = await UserService.findById(user.id);
      expect(updatedUser?.failedLoginAttempts).toBe(5);
      expect(updatedUser?.lockedUntil).toBeDefined();
      expect(updatedUser).toBeDefined();
      if (updatedUser) {
        expect(UserService.isUserLocked(updatedUser)).toBe(true);
      }
    });

    it('should reset failed attempts on successful login', async () => {
      const user = await UserService.createUser(testUser);
      
      // Increment failed attempts
      await UserService.incrementFailedAttempts(user.id);
      await UserService.incrementFailedAttempts(user.id);
      
      // Reset on successful login
      await UserService.resetFailedAttempts(user.id);
      
      const updatedUser = await UserService.findById(user.id);
      expect(updatedUser?.failedLoginAttempts).toBe(0);
      expect(updatedUser?.lockedUntil).toBeNull();
    });
  });

  describe('SessionService', () => {
    it('should create session successfully', async () => {
      const user = await UserService.createUser(testUser);
      const { session, tokens } = await SessionService.createSession(
        user.id,
        testUser.device,
        testUser.deviceId
      );
      
      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.userId).toBe(user.id);
      expect(session.deviceInfo).toEqual(testUser.device);
      expect(session.deviceId).toBe(testUser.deviceId);
      expect(session.revokedAt).toBeUndefined();
      
      expect(tokens).toBeDefined();
      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(tokens.sessionId).toBe(session.id);
    });

    it('should find session by ID', async () => {
      const user = await UserService.createUser(testUser);
      const { session } = await SessionService.createSession(
        user.id,
        testUser.device,
        testUser.deviceId
      );
      
      const foundSession = await SessionService.findById(session.id);
      expect(foundSession).toBeDefined();
      expect(foundSession?.id).toBe(session.id);
      expect(foundSession?.userId).toBe(user.id);
    });

    it('should verify and rotate refresh token', async () => {
      const user = await UserService.createUser(testUser);
      const { session, tokens } = await SessionService.createSession(
        user.id,
        testUser.device,
        testUser.deviceId
      );
      
      const result = await SessionService.verifyAndRotateRefreshToken(
        session.id,
        tokens.refreshToken,
        testUser.deviceId
      );
      
      expect(result).toBeDefined();
      expect(result?.tokens.refreshToken).not.toBe(tokens.refreshToken);
      expect(result?.tokens.accessToken).toBeDefined();
      expect(result?.session.id).toBe(session.id);
    });

    it('should revoke session', async () => {
      const user = await UserService.createUser(testUser);
      const { session } = await SessionService.createSession(
        user.id,
        testUser.device,
        testUser.deviceId
      );
      
      const success = await SessionService.revokeSession(session.id);
      expect(success).toBe(true);
      
      const revokedSession = await SessionService.findById(session.id);
      expect(revokedSession?.revokedAt).toBeDefined();
    });

    it('should revoke all user sessions', async () => {
      const user = await UserService.createUser(testUser);
      
      // Create multiple sessions
      const { session: session1 } = await SessionService.createSession(
        user.id,
        testUser.device,
        'device1'
      );
      const { session: session2 } = await SessionService.createSession(
        user.id,
        testUser.device,
        'device2'
      );
      
      await SessionService.revokeAllUserSessions(user.id);
      
      const revokedSession1 = await SessionService.findById(session1.id);
      const revokedSession2 = await SessionService.findById(session2.id);
      
      expect(revokedSession1?.revokedAt).toBeDefined();
      expect(revokedSession2?.revokedAt).toBeDefined();
    });
  });

  describe('TokenService', () => {
    it('should create and verify access token', async () => {
      const userId = 'test-user-id';
      const sessionId = 'test-session-id';
      
      const token = await TokenService.createAccessToken(userId, sessionId);
      expect(token).toBeDefined();
      
      const claims = await TokenService.verifyAccessToken(token);
      expect(claims.sub).toBe(userId);
      expect(claims.sid).toBe(sessionId);
      expect(claims.jti).toBeDefined();
      expect(claims.iat).toBeDefined();
      expect(claims.exp).toBeDefined();
    });

    it('should generate unique refresh tokens', () => {
      const token1 = TokenService.generateRefreshToken();
      const token2 = TokenService.generateRefreshToken();
      
      expect(token1).toBeDefined();
      expect(token2).toBeDefined();
      expect(token1).not.toBe(token2);
    });

    it('should check token expiration', () => {
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0IiwiaWF0IjoxNjAwMDAwMDAwLCJleHAiOjE2MDAwMDAwMDB9.test';
      
      const exp = TokenService.getTokenExpiration(token);
      expect(exp).toBe(1600000000000);
      
      const isExpired = TokenService.isTokenExpired(token);
      expect(isExpired).toBe(true);
    });
  });

  describe('PasswordResetService', () => {
    it('should generate password reset token', async () => {
      const user = await UserService.createUser(testUser);
      
      const result = await PasswordResetService.generateResetToken(
        testUser.email,
        '127.0.0.1',
        'test-agent'
      );
      
      expect(result).toBeDefined();
      expect(result?.token).toBeDefined();
      expect(result?.expiresAt).toBeDefined();
    });

    it('should return null for non-existent email', async () => {
      const result = await PasswordResetService.generateResetToken(
        'nonexistent@example.com'
      );
      
      expect(result).toBeNull();
    });

    it('should verify and consume reset token', async () => {
      const user = await UserService.createUser(testUser);
      const result = await PasswordResetService.generateResetToken(testUser.email);
      expect(result).toBeDefined();
      const { token } = result!;
      
      const success = await PasswordResetService.verifyAndConsumeToken(
        token,
        'NewPassword123'
      );
      
      expect(success).toBe(true);
      
      // Token should be consumed and not work again
      const secondAttempt = await PasswordResetService.verifyAndConsumeToken(
        token,
        'AnotherPassword123'
      );
      
      expect(secondAttempt).toBe(false);
    });
  });
});

async function cleanupTestData() {
  const collections = ['subsc', 'sessions', 'auditLogs', 'passwordResetTokens'];
  const batch = db.batch();
  
  for (const collection of collections) {
    const snapshot = await db.collection(collection).get();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
  }
  
  // Check if batch has any operations before committing
  for (const collection of collections) {
    const snapshot = await db.collection(collection).get();
    if (!snapshot.empty) {
      await batch.commit();
      break;
    }
  }
}
