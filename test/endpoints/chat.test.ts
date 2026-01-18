import request from 'supertest';
import { app } from '../../src/index';
import { logger } from '../../src/utils/logger';

describe('💬 Chat Endpoints - Comprehensive Test Suite', () => {
  let authToken: string;
  let testSessionId: string;

  beforeAll(async () => {
    logger.info('🚀 Starting Chat Endpoints Test Suite');
    // Mock auth token for testing
    authToken = 'mock-auth-token';
    testSessionId = 'test-session-123';
  });

  afterAll(async () => {
    logger.info('✅ Chat Endpoints Test Suite Completed');
  });

  describe('POST /chat/send', () => {
    const testCases = [
      {
        name: 'Valid chat message',
        data: {
          message: 'Hello, how are you?',
          sessionId: testSessionId
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 200,
        shouldSucceed: true
      },
      {
        name: 'Chat message without sessionId',
        data: {
          message: 'Hello, how are you?'
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'Chat message without message',
        data: {
          sessionId: testSessionId
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'Chat message without auth token',
        data: {
          message: 'Hello, how are you?',
          sessionId: testSessionId
        },
        headers: {},
        expectedStatus: 401,
        shouldSucceed: false
      },
      {
        name: 'Empty message',
        data: {
          message: '',
          sessionId: testSessionId
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'Very long message',
        data: {
          message: 'A'.repeat(10000),
          sessionId: testSessionId
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'Message with special characters',
        data: {
          message: 'Hello! @#$%^&*()_+{}|:"<>?[]\\;\',./',
          sessionId: testSessionId
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 200,
        shouldSucceed: true
      },
      {
        name: 'Message with emojis',
        data: {
          message: 'Hello! 😀🎉🚀💯',
          sessionId: testSessionId
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 200,
        shouldSucceed: true
      }
    ];

    testCases.forEach((testCase, index) => {
      it(`Test Case ${index + 1}: ${testCase.name}`, async () => {
        logger.info(`🧪 Running: ${testCase.name}`);
        
        const startTime = Date.now();
        const response = await request(app)
          .post('/chat/send')
          .set(testCase.headers)
          .send(testCase.data)
          .expect(testCase.expectedStatus);
        
        const duration = Date.now() - startTime;
        
        if (testCase.shouldSucceed) {
          expect(response.body.success).toBe(true);
          expect(response.body.data).toHaveProperty('messageId');
          expect(response.body.data).toHaveProperty('response');
          logger.info(`✅ SUCCESS: ${testCase.name} (${duration}ms)`);
        } else {
          expect(response.body.success).toBe(false);
          expect(response.body.error).toBeDefined();
          logger.info(`❌ EXPECTED FAILURE: ${testCase.name} - ${response.body.error} (${duration}ms)`);
        }
      });
    });
  });

  describe('GET /chat/history/:sessionId', () => {
    const testCases = [
      {
        name: 'Get chat history with valid session',
        sessionId: testSessionId,
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 200,
        shouldSucceed: true
      },
      {
        name: 'Get chat history without auth token',
        sessionId: testSessionId,
        headers: {},
        expectedStatus: 401,
        shouldSucceed: false
      },
      {
        name: 'Get chat history with invalid session',
        sessionId: 'invalid-session-id',
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 404,
        shouldSucceed: false
      },
      {
        name: 'Get chat history with empty sessionId',
        sessionId: '',
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 404,
        shouldSucceed: false
      }
    ];

    testCases.forEach((testCase, index) => {
      it(`Test Case ${index + 1}: ${testCase.name}`, async () => {
        logger.info(`🧪 Running: ${testCase.name}`);
        
        const startTime = Date.now();
        const response = await request(app)
          .get(`/chat/history/${testCase.sessionId}`)
          .set(testCase.headers)
          .expect(testCase.expectedStatus);
        
        const duration = Date.now() - startTime;
        
        if (testCase.shouldSucceed) {
          expect(response.body.success).toBe(true);
          expect(response.body.data).toHaveProperty('messages');
          expect(Array.isArray(response.body.data.messages)).toBe(true);
          logger.info(`✅ SUCCESS: ${testCase.name} (${duration}ms)`);
        } else {
          expect(response.body.success).toBe(false);
          expect(response.body.error).toBeDefined();
          logger.info(`❌ EXPECTED FAILURE: ${testCase.name} - ${response.body.error} (${duration}ms)`);
        }
      });
    });
  });

  describe('DELETE /chat/session/:sessionId', () => {
    const testCases = [
      {
        name: 'Delete chat session with valid session',
        sessionId: testSessionId,
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 200,
        shouldSucceed: true
      },
      {
        name: 'Delete chat session without auth token',
        sessionId: testSessionId,
        headers: {},
        expectedStatus: 401,
        shouldSucceed: false
      },
      {
        name: 'Delete chat session with invalid session',
        sessionId: 'invalid-session-id',
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 404,
        shouldSucceed: false
      }
    ];

    testCases.forEach((testCase, index) => {
      it(`Test Case ${index + 1}: ${testCase.name}`, async () => {
        logger.info(`🧪 Running: ${testCase.name}`);
        
        const startTime = Date.now();
        const response = await request(app)
          .delete(`/chat/session/${testCase.sessionId}`)
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

  describe('GET /chat/sessions', () => {
    const testCases = [
      {
        name: 'Get user chat sessions',
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 200,
        shouldSucceed: true
      },
      {
        name: 'Get chat sessions without auth token',
        headers: {},
        expectedStatus: 401,
        shouldSucceed: false
      },
      {
        name: 'Get chat sessions with invalid token',
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
          .get('/chat/sessions')
          .set(testCase.headers)
          .expect(testCase.expectedStatus);
        
        const duration = Date.now() - startTime;
        
        if (testCase.shouldSucceed) {
          expect(response.body.success).toBe(true);
          expect(response.body.data).toHaveProperty('sessions');
          expect(Array.isArray(response.body.data.sessions)).toBe(true);
          logger.info(`✅ SUCCESS: ${testCase.name} (${duration}ms)`);
        } else {
          expect(response.body.success).toBe(false);
          expect(response.body.error).toBeDefined();
          logger.info(`❌ EXPECTED FAILURE: ${testCase.name} - ${response.body.error} (${duration}ms)`);
        }
      });
    });
  });

  describe('POST /chat/tts', () => {
    const testCases = [
      {
        name: 'Valid TTS request',
        data: {
          text: 'Hello, this is a test message for text to speech.',
          sessionId: testSessionId
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 200,
        shouldSucceed: true
      },
      {
        name: 'TTS request without text',
        data: {
          sessionId: testSessionId
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'TTS request without sessionId',
        data: {
          text: 'Hello, this is a test message for text to speech.'
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'TTS request without auth token',
        data: {
          text: 'Hello, this is a test message for text to speech.',
          sessionId: testSessionId
        },
        headers: {},
        expectedStatus: 401,
        shouldSucceed: false
      },
      {
        name: 'TTS request with empty text',
        data: {
          text: '',
          sessionId: testSessionId
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'TTS request with very long text',
        data: {
          text: 'A'.repeat(5000),
          sessionId: testSessionId
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
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
          .post('/chat/tts')
          .set(testCase.headers)
          .send(testCase.data)
          .expect(testCase.expectedStatus);
        
        const duration = Date.now() - startTime;
        
        if (testCase.shouldSucceed) {
          expect(response.body.success).toBe(true);
          expect(response.body.data).toHaveProperty('audioUrl');
          logger.info(`✅ SUCCESS: ${testCase.name} (${duration}ms)`);
        } else {
          expect(response.body.success).toBe(false);
          expect(response.body.error).toBeDefined();
          logger.info(`❌ EXPECTED FAILURE: ${testCase.name} - ${response.body.error} (${duration}ms)`);
        }
      });
    });
  });
});








