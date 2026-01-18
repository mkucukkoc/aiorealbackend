import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/index';
import { db } from '../src/firebase';
import { HashService } from '../src/services/hashService';
import { UserService } from '../src/services/userService';
import { SessionService } from '../src/services/sessionService';

describe('Authentication API', () => {
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
    // Clean up test data
    await cleanupTestData();
  });

  afterEach(async () => {
    // Clean up test data
    await cleanupTestData();
  });

  describe('POST /auth/register', () => {
    it('should register a new user successfully', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send(testUser)
        .expect(201);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('sessionId');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe(testUser.email);
      expect(response.body.user.name).toBe(testUser.name);
    });

    it('should reject registration with invalid email', async () => {
      const invalidUser = { ...testUser, email: 'invalid-email' };
      
      const response = await request(app)
        .post('/auth/register')
        .send(invalidUser)
        .expect(400);

      expect(response.body.error).toBe('validation_error');
    });

    it('should reject registration with weak password', async () => {
      const weakPasswordUser = { ...testUser, password: '123' };
      
      const response = await request(app)
        .post('/auth/register')
        .send(weakPasswordUser)
        .expect(400);

      expect(response.body.error).toBe('validation_error');
    });

    it('should reject duplicate email registration', async () => {
      // First registration
      await request(app)
        .post('/auth/register')
        .send(testUser)
        .expect(201);

      // Second registration with same email
      const response = await request(app)
        .post('/auth/register')
        .send(testUser)
        .expect(409);

      expect(response.body.error).toBe('email_already_registered');
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      // Create a test user
      await UserService.createUser(testUser);
    });

    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
          device: testUser.device,
          deviceId: testUser.deviceId,
        })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('sessionId');
      expect(response.body).toHaveProperty('user');
    });

    it('should reject login with invalid email', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: testUser.password,
          device: testUser.device,
        })
        .expect(401);

      expect(response.body.error).toBe('invalid_credentials');
    });

    it('should reject login with invalid password', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: testUser.email,
          password: 'wrongpassword',
          device: testUser.device,
        })
        .expect(401);

      expect(response.body.error).toBe('invalid_credentials');
    });

    it('should lock account after multiple failed attempts', async () => {
      // Make 5 failed login attempts
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/auth/login')
          .send({
            email: testUser.email,
            password: 'wrongpassword',
            device: testUser.device,
          })
          .expect(401);
      }

      // 6th attempt should be locked
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
          device: testUser.device,
        })
        .expect(423);

      expect(response.body.error).toBe('account_locked');
    });
  });

  describe('POST /auth/refresh', () => {
    let refreshToken: string;
    let sessionId: string;

    beforeEach(async () => {
      // Create user and session
      const user = await UserService.createUser(testUser);
      const { session, tokens } = await SessionService.createSession(
        user.id,
        testUser.device,
        testUser.deviceId
      );
      refreshToken = tokens.refreshToken;
      sessionId = tokens.sessionId;
    });

    it('should refresh tokens successfully', async () => {
      const response = await request(app)
        .post('/auth/refresh')
        .send({
          refreshToken,
          sessionId,
          deviceId: testUser.deviceId,
        })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('sessionId');
      
      // New refresh token should be different
      expect(response.body.refreshToken).not.toBe(refreshToken);
    });

    it('should reject refresh with invalid token', async () => {
      const response = await request(app)
        .post('/auth/refresh')
        .send({
          refreshToken: 'invalid-token',
          sessionId,
          deviceId: testUser.deviceId,
        })
        .expect(401);

      expect(response.body.error).toBe('invalid_refresh_token');
    });

    it('should detect token reuse and revoke all sessions', async () => {
      // First refresh
      await request(app)
        .post('/auth/refresh')
        .send({
          refreshToken,
          sessionId,
          deviceId: testUser.deviceId,
        })
        .expect(200);

      // Try to use the old refresh token again
      const response = await request(app)
        .post('/auth/refresh')
        .send({
          refreshToken, // This is now the old token
          sessionId,
          deviceId: testUser.deviceId,
        })
        .expect(401);

      expect(response.body.error).toBe('token_reuse_detected');
    });
  });

  describe('POST /auth/logout', () => {
    let sessionId: string;

    beforeEach(async () => {
      // Create user and session
      const user = await UserService.createUser(testUser);
      const { session } = await SessionService.createSession(
        user.id,
        testUser.device,
        testUser.deviceId
      );
      sessionId = session.id;
    });

    it('should logout successfully', async () => {
      const response = await request(app)
        .post('/auth/logout')
        .send({ sessionId })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should handle logout of non-existent session', async () => {
      const response = await request(app)
        .post('/auth/logout')
        .send({ sessionId: 'non-existent-session' })
        .expect(200);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /auth/me', () => {
    let accessToken: string;

    beforeEach(async () => {
      // Create user and session
      const user = await UserService.createUser(testUser);
      const { tokens } = await SessionService.createSession(
        user.id,
        testUser.device,
        testUser.deviceId
      );
      accessToken = tokens.accessToken;
    });

    it('should return user info with valid token', async () => {
      const response = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('email');
      expect(response.body.email).toBe(testUser.email);
    });

    it('should reject request without token', async () => {
      const response = await request(app)
        .get('/auth/me')
        .expect(401);

      expect(response.body.error).toBe('unauthorized');
    });

    it('should reject request with invalid token', async () => {
      const response = await request(app)
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error).toBe('unauthorized');
    });
  });

  describe('POST /auth/logout-all', () => {
    let accessToken: string;

    beforeEach(async () => {
      // Create user and session
      const user = await UserService.createUser(testUser);
      const { tokens } = await SessionService.createSession(
        user.id,
        testUser.device,
        testUser.deviceId
      );
      accessToken = tokens.accessToken;
    });

    it('should logout all sessions', async () => {
      const response = await request(app)
        .post('/auth/logout-all')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should reject request without token', async () => {
      const response = await request(app)
        .post('/auth/logout-all')
        .expect(401);

      expect(response.body.error).toBe('unauthorized');
    });
  });
});

async function cleanupTestData() {
  // Clean up test users
  const testUserEmail = 'test@example.com';
  const usersSnapshot = await db
    .collection('subsc')
    .where('email', '==', testUserEmail)
    .get();
  
  const batch = db.batch();
  usersSnapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });

  // Clean up test sessions
  const sessionsSnapshot = await db
    .collection('sessions')
    .get();
  
  sessionsSnapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });

  // Clean up test audit logs
  const auditSnapshot = await db
    .collection('auditLogs')
    .get();
  
  auditSnapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });

  if (!usersSnapshot.empty || !sessionsSnapshot.empty || !auditSnapshot.empty) {
    await batch.commit();
  }
}