import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/index';
import { UserService } from '../src/services/userService';
import { SessionService } from '../src/services/sessionService';
import { db } from '../src/firebase';

describe('Middleware', () => {
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

  describe('Rate Limiting', () => {
    it('should apply rate limiting to login endpoint', async () => {
      // Make multiple requests quickly
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          request(app)
            .post('/auth/login')
            .send({
              email: 'test@example.com',
              password: 'wrongpassword',
              device: testUser.device,
            })
        );
      }

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited
      const rateLimitedResponses = responses.filter(
        res => res.status === 429
      );
      
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    it('should apply rate limiting to register endpoint', async () => {
      // Make multiple registration requests
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          request(app)
            .post('/auth/register')
            .send({
              ...testUser,
              email: `test${i}@example.com`,
            })
        );
      }

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited
      const rateLimitedResponses = responses.filter(
        res => res.status === 429
      );
      
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  describe('Validation Middleware', () => {
    it('should validate register request body', async () => {
      const invalidUser = {
        email: 'invalid-email',
        password: '123', // Too short
        device: testUser.device,
      };

      const response = await request(app)
        .post('/auth/register')
        .send(invalidUser)
        .expect(400);

      expect(response.body.error).toBe('validation_error');
      expect(response.body.details).toBeDefined();
    });

    it('should validate login request body', async () => {
      const invalidLogin = {
        email: 'invalid-email',
        password: '',
        device: testUser.device,
      };

      const response = await request(app)
        .post('/auth/login')
        .send(invalidLogin)
        .expect(400);

      expect(response.body.error).toBe('validation_error');
    });

    it('should validate refresh request body', async () => {
      const invalidRefresh = {
        refreshToken: '',
        sessionId: 'invalid-uuid',
        deviceId: testUser.deviceId,
      };

      const response = await request(app)
        .post('/auth/refresh')
        .send(invalidRefresh)
        .expect(400);

      expect(response.body.error).toBe('validation_error');
    });

    it('should validate logout request body', async () => {
      const invalidLogout = {
        sessionId: 'invalid-uuid',
      };

      const response = await request(app)
        .post('/auth/logout')
        .send(invalidLogout)
        .expect(400);

      expect(response.body.error).toBe('validation_error');
    });
  });

  describe('Authentication Middleware', () => {
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

    it('should authenticate valid token', async () => {
      const response = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('email');
    });

    it('should reject request without authorization header', async () => {
      const response = await request(app)
        .get('/auth/me')
        .expect(401);

      expect(response.body.error).toBe('unauthorized');
      expect(response.body.message).toContain('Missing or invalid authorization header');
    });

    it('should reject request with invalid authorization format', async () => {
      const response = await request(app)
        .get('/auth/me')
        .set('Authorization', 'InvalidFormat token')
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

    it('should reject request with expired token', async () => {
      // Create an expired token (this would require mocking time)
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0IiwiaWF0IjoxNjAwMDAwMDAwLCJleHAiOjE2MDAwMDAwMDB9.test';
      
      const response = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body.error).toBe('unauthorized');
    });

    it('should reject request with revoked session', async () => {
      // Revoke the session
      const user = await UserService.findByEmail(testUser.email);
      if (user) {
        await SessionService.revokeAllUserSessions(user.id);
      }

      const response = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);

      expect(response.body.error).toBe('unauthorized');
      expect(response.body.message).toContain('Session is invalid or expired');
    });
  });

  describe('CORS Middleware', () => {
    it('should include CORS headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });

  describe('Security Headers', () => {
    it('should include security headers from helmet', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // Helmet adds various security headers
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBeDefined();
    });
  });
});

async function cleanupTestData() {
  const collections = ['subsc', 'sessions', 'auditLogs'];
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
