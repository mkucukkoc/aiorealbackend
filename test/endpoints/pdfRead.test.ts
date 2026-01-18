import request from 'supertest';
import { app } from '../../src/index';
import { logger } from '../../src/utils/logger';

describe('📄 PDF Read Endpoints - Comprehensive Test Suite', () => {
  let authToken: string;

  beforeAll(async () => {
    logger.info('🚀 Starting PDF Read Endpoints Test Suite');
    authToken = 'mock-auth-token';
  });

  afterAll(async () => {
    logger.info('✅ PDF Read Endpoints Test Suite Completed');
  });

  describe('POST /pdf-read/upload', () => {
    const testCases = [
      {
        name: 'Valid PDF upload',
        file: 'test.pdf',
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 200,
        shouldSucceed: true
      },
      {
        name: 'Upload without file',
        file: null,
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'Upload without auth token',
        file: 'test.pdf',
        headers: {},
        expectedStatus: 401,
        shouldSucceed: false
      },
      {
        name: 'Upload non-PDF file',
        file: 'test.txt',
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'Upload oversized PDF',
        file: 'large.pdf',
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 413,
        shouldSucceed: false
      }
    ];

    testCases.forEach((testCase, index) => {
      it(`Test Case ${index + 1}: ${testCase.name}`, async () => {
        logger.info(`🧪 Running: ${testCase.name}`);
        
        const startTime = Date.now();
        let response;
        
        if (testCase.file) {
          response = await request(app)
            .post('/pdf-read/upload')
            .set(testCase.headers)
            .attach('file', Buffer.from('mock pdf content'), 'test.pdf')
            .expect(testCase.expectedStatus);
        } else {
          response = await request(app)
            .post('/pdf-read/upload')
            .set(testCase.headers)
            .expect(testCase.expectedStatus);
        }
        
        const duration = Date.now() - startTime;
        
        if (testCase.shouldSucceed) {
          expect(response.body.success).toBe(true);
          expect(response.body.data).toHaveProperty('fileId');
          logger.info(`✅ SUCCESS: ${testCase.name} (${duration}ms)`);
        } else {
          expect(response.body.success).toBe(false);
          expect(response.body.error).toBeDefined();
          logger.info(`❌ EXPECTED FAILURE: ${testCase.name} - ${response.body.error} (${duration}ms)`);
        }
      });
    });
  });

  describe('POST /pdf-read/summarize', () => {
    const testCases = [
      {
        name: 'Valid PDF summarization',
        data: {
          fileId: 'test-file-id',
          options: {
            maxLength: 500,
            includeKeyPoints: true
          }
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 200,
        shouldSucceed: true
      },
      {
        name: 'Summarize without fileId',
        data: {
          options: {
            maxLength: 500,
            includeKeyPoints: true
          }
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'Summarize without auth token',
        data: {
          fileId: 'test-file-id',
          options: {
            maxLength: 500,
            includeKeyPoints: true
          }
        },
        headers: {},
        expectedStatus: 401,
        shouldSucceed: false
      },
      {
        name: 'Summarize with invalid fileId',
        data: {
          fileId: 'invalid-file-id',
          options: {
            maxLength: 500,
            includeKeyPoints: true
          }
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 404,
        shouldSucceed: false
      },
      {
        name: 'Summarize with invalid options',
        data: {
          fileId: 'test-file-id',
          options: {
            maxLength: -100,
            includeKeyPoints: 'invalid'
          }
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
          .post('/pdf-read/summarize')
          .set(testCase.headers)
          .send(testCase.data)
          .expect(testCase.expectedStatus);
        
        const duration = Date.now() - startTime;
        
        if (testCase.shouldSucceed) {
          expect(response.body.success).toBe(true);
          expect(response.body.data).toHaveProperty('summary');
          expect(response.body.data).toHaveProperty('keyPoints');
          logger.info(`✅ SUCCESS: ${testCase.name} (${duration}ms)`);
        } else {
          expect(response.body.success).toBe(false);
          expect(response.body.error).toBeDefined();
          logger.info(`❌ EXPECTED FAILURE: ${testCase.name} - ${response.body.error} (${duration}ms)`);
        }
      });
    });
  });

  describe('POST /pdf-read/generate-doc', () => {
    const testCases = [
      {
        name: 'Valid document generation',
        data: {
          prompt: 'Create a comprehensive report about climate change',
          fileId: 'test-file-id'
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 200,
        shouldSucceed: true
      },
      {
        name: 'Generate doc without prompt',
        data: {
          fileId: 'test-file-id'
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'Generate doc without fileId',
        data: {
          prompt: 'Create a comprehensive report about climate change'
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'Generate doc without auth token',
        data: {
          prompt: 'Create a comprehensive report about climate change',
          fileId: 'test-file-id'
        },
        headers: {},
        expectedStatus: 401,
        shouldSucceed: false
      },
      {
        name: 'Generate doc with empty prompt',
        data: {
          prompt: '',
          fileId: 'test-file-id'
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'Generate doc with very long prompt',
        data: {
          prompt: 'A'.repeat(10000),
          fileId: 'test-file-id'
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
          .post('/pdf-read/generate-doc')
          .set(testCase.headers)
          .send(testCase.data)
          .expect(testCase.expectedStatus);
        
        const duration = Date.now() - startTime;
        
        if (testCase.shouldSucceed) {
          expect(response.body.success).toBe(true);
          expect(response.body.data).toHaveProperty('documentUrl');
          logger.info(`✅ SUCCESS: ${testCase.name} (${duration}ms)`);
        } else {
          expect(response.body.success).toBe(false);
          expect(response.body.error).toBeDefined();
          logger.info(`❌ EXPECTED FAILURE: ${testCase.name} - ${response.body.error} (${duration}ms)`);
        }
      });
    });
  });

  describe('POST /pdf-read/generate-ppt', () => {
    const testCases = [
      {
        name: 'Valid presentation generation',
        data: {
          prompt: 'Create a presentation about renewable energy',
          fileId: 'test-file-id'
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 200,
        shouldSucceed: true
      },
      {
        name: 'Generate PPT without prompt',
        data: {
          fileId: 'test-file-id'
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'Generate PPT without fileId',
        data: {
          prompt: 'Create a presentation about renewable energy'
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 400,
        shouldSucceed: false
      },
      {
        name: 'Generate PPT without auth token',
        data: {
          prompt: 'Create a presentation about renewable energy',
          fileId: 'test-file-id'
        },
        headers: {},
        expectedStatus: 401,
        shouldSucceed: false
      }
    ];

    testCases.forEach((testCase, index) => {
      it(`Test Case ${index + 1}: ${testCase.name}`, async () => {
        logger.info(`🧪 Running: ${testCase.name}`);
        
        const startTime = Date.now();
        const response = await request(app)
          .post('/pdf-read/generate-ppt')
          .set(testCase.headers)
          .send(testCase.data)
          .expect(testCase.expectedStatus);
        
        const duration = Date.now() - startTime;
        
        if (testCase.shouldSucceed) {
          expect(response.body.success).toBe(true);
          expect(response.body.data).toHaveProperty('presentationUrl');
          logger.info(`✅ SUCCESS: ${testCase.name} (${duration}ms)`);
        } else {
          expect(response.body.success).toBe(false);
          expect(response.body.error).toBeDefined();
          logger.info(`❌ EXPECTED FAILURE: ${testCase.name} - ${response.body.error} (${duration}ms)`);
        }
      });
    });
  });

  describe('GET /pdf-read/files', () => {
    const testCases = [
      {
        name: 'Get user files with auth token',
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 200,
        shouldSucceed: true
      },
      {
        name: 'Get files without auth token',
        headers: {},
        expectedStatus: 401,
        shouldSucceed: false
      },
      {
        name: 'Get files with invalid token',
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
          .get('/pdf-read/files')
          .set(testCase.headers)
          .expect(testCase.expectedStatus);
        
        const duration = Date.now() - startTime;
        
        if (testCase.shouldSucceed) {
          expect(response.body.success).toBe(true);
          expect(response.body.data).toHaveProperty('files');
          expect(Array.isArray(response.body.data.files)).toBe(true);
          logger.info(`✅ SUCCESS: ${testCase.name} (${duration}ms)`);
        } else {
          expect(response.body.success).toBe(false);
          expect(response.body.error).toBeDefined();
          logger.info(`❌ EXPECTED FAILURE: ${testCase.name} - ${response.body.error} (${duration}ms)`);
        }
      });
    });
  });

  describe('DELETE /pdf-read/files/:fileId', () => {
    const testCases = [
      {
        name: 'Delete file with valid fileId',
        fileId: 'test-file-id',
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 200,
        shouldSucceed: true
      },
      {
        name: 'Delete file without auth token',
        fileId: 'test-file-id',
        headers: {},
        expectedStatus: 401,
        shouldSucceed: false
      },
      {
        name: 'Delete file with invalid fileId',
        fileId: 'invalid-file-id',
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        expectedStatus: 404,
        shouldSucceed: false
      },
      {
        name: 'Delete file with empty fileId',
        fileId: '',
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
          .delete(`/pdf-read/files/${testCase.fileId}`)
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
});








