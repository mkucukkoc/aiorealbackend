import request from 'supertest';
import { app } from '../../src/index';
import { logger } from '../../src/utils/logger';

describe('🔐 Auth Endpoints - Comprehensive Test Suite', () => {
  let testUser: any;
  let authToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    logger.info('🚀 Starting Auth Endpoints Test Suite');
  });

  afterAll(async () => {
    logger.info('✅ Auth Endpoints Test Suite Completed');
  });

  describe('POST /auth/register', () => {
    const testCases = [
      {
        name: 'Valid user registration',
        data: {
          email: 'test@example.com',
          password: 'TestPassword123!',
          firstName: 'Test',
          lastName: 'User'
        },
        expectedStatus: 201,
        shouldSucceed: true
      },
      {
        name: 'Registration with invalid email',
        data: {
          email: 'invalid-email',
          password: 'TestPassword123!',
          firstName: 'Test',
          lastName: 'User'
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'Registration with weak password',
        data: {
          email: 'test2@example.com',
          password: '123',
          firstName: 'Test',
          lastName: 'User'
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'Registration with missing fields',
        data: {
          email: 'test3@example.com',
          password: 'TestPassword123!'
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'Registration with duplicate email',
        data: {
          email: 'test@example.com',
          password: 'TestPassword123!',
          firstName: 'Test',
          lastName: 'User'
        },
        expectedStatus: 409,
        shouldSucceed: false
      }
    ];

    testCases.forEach((testCase, index) => {
      it(`Test Case ${index + 1}: ${testCase.name}`, async () => {
        logger.info(`🧪 Running: ${testCase.name}`);
        
        const startTime = Date.now();
        const response = await request(app)
          .post('/auth/register')
          .send(testCase.data)
          .expect(testCase.expectedStatus);
        
        const duration = Date.now() - startTime;
        
        if (testCase.shouldSucceed) {
          expect(response.body.success).toBe(true);
          expect(response.body.data).toHaveProperty('user');
          expect(response.body.data).toHaveProperty('tokens');
          testUser = response.body.data.user;
          authToken = response.body.data.tokens.accessToken;
          refreshToken = response.body.data.tokens.refreshToken;
          logger.info(`✅ SUCCESS: ${testCase.name} (${duration}ms)`);
        } else {
          expect(response.body.success).toBe(false);
          expect(response.body.error).toBeDefined();
          logger.info(`❌ EXPECTED FAILURE: ${testCase.name} - ${response.body.error} (${duration}ms)`);
        }
      });
    });
  });

  describe('POST /auth/login', () => {
    const testCases = [
      {
        name: 'Valid login credentials',
        data: {
          email: 'test@example.com',
          password: 'TestPassword123!'
        },
        expectedStatus: 200,
        shouldSucceed: true
      },
      {
        name: 'Login with wrong password',
        data: {
          email: 'test@example.com',
          password: 'WrongPassword123!'
        },
        expectedStatus: 401,
        shouldSucceed: false
      },
      {
        name: 'Login with non-existent email',
        data: {
          email: 'nonexistent@example.com',
          password: 'TestPassword123!'
        },
        expectedStatus: 401,
        shouldSucceed: false
      },
      {
        name: 'Login with missing email',
        data: {
          password: 'TestPassword123!'
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'Login with missing password',
        data: {
          email: 'test@example.com'
        },
        expectedStatus: 400,
        shouldSucceed: false
      }
    ];

    testCases.forEach((testCase, index) => {
      it(`Test Case ${index + 1}: ${testCase.name}`, async () => {
        logger.info(`🧪 Running: ${testCase.name}`);
        
        const startTime = Date.now();
        const response = await request(app)
          .post('/auth/login')
          .send(testCase.data)
          .expect(testCase.expectedStatus);
        
        const duration = Date.now() - startTime;
        
        if (testCase.shouldSucceed) {
          expect(response.body.success).toBe(true);
          expect(response.body.data).toHaveProperty('user');
          expect(response.body.data).toHaveProperty('tokens');
          logger.info(`✅ SUCCESS: ${testCase.name} (${duration}ms)`);
        } else {
          expect(response.body.success).toBe(false);
          expect(response.body.error).toBeDefined();
          logger.info(`❌ EXPECTED FAILURE: ${testCase.name} - ${response.body.error} (${duration}ms)`);
        }
      });
    });
  });

  describe('POST /auth/refresh-token', () => {
    const testCases = [
      {
        name: 'Valid refresh token',
        data: {
          refreshToken: 'valid-refresh-token'
        },
        expectedStatus: 200,
        shouldSucceed: true
      },
      {
        name: 'Invalid refresh token',
        data: {
          refreshToken: 'invalid-refresh-token'
        },
        expectedStatus: 401,
        shouldSucceed: false
      },
      {
        name: 'Missing refresh token',
        data: {},
        expectedStatus: 400,
        shouldSucceed: false
      }
    ];

    testCases.forEach((testCase, index) => {
      it(`Test Case ${index + 1}: ${testCase.name}`, async () => {
        logger.info(`🧪 Running: ${testCase.name}`);
        
        const startTime = Date.now();
        const response = await request(app)
          .post('/auth/refresh-token')
          .send(testCase.data)
          .expect(testCase.expectedStatus);
        
        const duration = Date.now() - startTime;
        
        if (testCase.shouldSucceed) {
          expect(response.body.success).toBe(true);
          expect(response.body.data).toHaveProperty('accessToken');
          logger.info(`✅ SUCCESS: ${testCase.name} (${duration}ms)`);
        } else {
          expect(response.body.success).toBe(false);
          expect(response.body.error).toBeDefined();
          logger.info(`❌ EXPECTED FAILURE: ${testCase.name} - ${response.body.error} (${duration}ms)`);
        }
      });
    });
  });

  describe('POST /auth/logout', () => {
    const testCases = [
      {
        name: 'Valid logout with token',
        headers: {
          'Authorization': 'Bearer valid-token'
        },
        expectedStatus: 200,
        shouldSucceed: true
      },
      {
        name: 'Logout without token',
        headers: {},
        expectedStatus: 401,
        shouldSucceed: false
      },
      {
        name: 'Logout with invalid token',
        headers: {
          'Authorization': 'Bearer invalid-token'
        },
        expectedStatus: 401,
        shouldSucceed: false
      }
    ];

    testCases.forEach((testCase, index) => {
      it(`Test Case ${index + 1}: ${testCase.name}`, async () => {
        logger.info(`🧪 Running: ${testCase.name}`);
        
        const startTime = Date.now();
        const response = await request(app)
          .post('/auth/logout')
          .set(testCase.headers)
          .expect(testCase.expectedStatus);
        
        const duration = Date.now() - startTime;
        
        if (testCase.shouldSucceed) {
          expect(response.body.success).toBe(true);
          logger.info(`✅ SUCCESS: ${testCase.name} (${duration}ms)`);
        } else {
          expect(response.body.success).toBe(false);
          expect(response.body.error).toBeDefined();
          logger.info(`❌ EXPECTED FAILURE: ${testCase.name} - ${response.body.error} (${duration}ms)`);
        }
      });
    });
  });

  describe('GET /auth/me', () => {
    const testCases = [
      {
        name: 'Get profile with valid token',
        headers: {
          'Authorization': 'Bearer valid-token'
        },
        expectedStatus: 200,
        shouldSucceed: true
      },
      {
        name: 'Get profile without token',
        headers: {},
        expectedStatus: 401,
        shouldSucceed: false
      },
      {
        name: 'Get profile with invalid token',
        headers: {
          'Authorization': 'Bearer invalid-token'
        },
        expectedStatus: 401,
        shouldSucceed: false
      }
    ];

    testCases.forEach((testCase, index) => {
      it(`Test Case ${index + 1}: ${testCase.name}`, async () => {
        logger.info(`🧪 Running: ${testCase.name}`);
        
        const startTime = Date.now();
        const response = await request(app)
          .get('/auth/me')
          .set(testCase.headers)
          .expect(testCase.expectedStatus);
        
        const duration = Date.now() - startTime;
        
        if (testCase.shouldSucceed) {
          expect(response.body.success).toBe(true);
          expect(response.body.data).toHaveProperty('user');
          logger.info(`✅ SUCCESS: ${testCase.name} (${duration}ms)`);
        } else {
          expect(response.body.success).toBe(false);
          expect(response.body.error).toBeDefined();
          logger.info(`❌ EXPECTED FAILURE: ${testCase.name} - ${response.body.error} (${duration}ms)`);
        }
      });
    });
  });

  describe('GET /auth/test-firebase', () => {
    it('Test Firebase connection', async () => {
      logger.info('🧪 Running: Test Firebase connection');
      
      const startTime = Date.now();
      const response = await request(app)
        .get('/auth/test-firebase')
        .expect(200);
      
      const duration = Date.now() - startTime;
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('firestore');
      expect(response.body.data).toHaveProperty('auth');
      logger.info(`✅ SUCCESS: Test Firebase connection (${duration}ms)`);
    });
  });
});
