import request from 'supertest';
import { app } from '../../src/index';
import { logger } from '../../src/utils/logger';

describe('🔄 Regression Test Suite - Critical Path Testing', () => {
  let authToken: string;
  let testUserId: string;
  let testSessionId: string;
  let testFileId: string;

  beforeAll(async () => {
    logger.info('🚀 Starting Regression Test Suite');
    authToken = 'mock-auth-token';
    testUserId = 'test-user-123';
    testSessionId = 'test-session-123';
    testFileId = 'test-file-123';
  });

  afterAll(async () => {
    logger.info('✅ Regression Test Suite Completed');
  });

  describe('🔐 Critical Path 1: User Authentication Flow', () => {
    it('Complete user registration and login flow', async () => {
      logger.info('🧪 Running: Complete user registration and login flow');
      
      // Step 1: Register new user
      const registerStart = Date.now();
      const registerResponse = await request(app)
        .post('/auth/register')
        .send({
          email: 'regression@example.com',
          password: 'RegressionTest123!',
          firstName: 'Regression',
          lastName: 'Test'
        });
      const registerDuration = Date.now() - registerStart;
      
      expect(registerResponse.status).toBe(201);
      expect(registerResponse.body.success).toBe(true);
      expect(registerResponse.body.data.user).toBeDefined();
      expect(registerResponse.body.data.tokens).toBeDefined();
      
      logger.info(`✅ User registration completed in ${registerDuration}ms`);
      
      // Step 2: Login with registered user
      const loginStart = Date.now();
      const loginResponse = await request(app)
        .post('/auth/login')
        .send({
          email: 'regression@example.com',
          password: 'RegressionTest123!'
        });
      const loginDuration = Date.now() - loginStart;
      
      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body.success).toBe(true);
      expect(loginResponse.body.data.tokens.accessToken).toBeDefined();
      
      logger.info(`✅ User login completed in ${loginDuration}ms`);
      
      // Step 3: Get user profile
      const profileStart = Date.now();
      const profileResponse = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${loginResponse.body.data.tokens.accessToken}`);
      const profileDuration = Date.now() - profileStart;
      
      expect(profileResponse.status).toBe(200);
      expect(profileResponse.body.success).toBe(true);
      expect(profileResponse.body.data.user.email).toBe('regression@example.com');
      
      logger.info(`✅ User profile retrieval completed in ${profileDuration}ms`);
    });

    it('Token refresh and logout flow', async () => {
      logger.info('🧪 Running: Token refresh and logout flow');
      
      // Step 1: Refresh token
      const refreshStart = Date.now();
      const refreshResponse = await request(app)
        .post('/auth/refresh-token')
        .send({
          refreshToken: 'valid-refresh-token'
        });
      const refreshDuration = Date.now() - refreshStart;
      
      expect(refreshResponse.status).toBe(200);
      expect(refreshResponse.body.success).toBe(true);
      expect(refreshResponse.body.data.accessToken).toBeDefined();
      
      logger.info(`✅ Token refresh completed in ${refreshDuration}ms`);
      
      // Step 2: Logout
      const logoutStart = Date.now();
      const logoutResponse = await request(app)
        .post('/auth/logout')
        .set('Authorization', 'Bearer valid-token');
      const logoutDuration = Date.now() - logoutStart;
      
      expect(logoutResponse.status).toBe(200);
      expect(logoutResponse.body.success).toBe(true);
      
      logger.info(`✅ User logout completed in ${logoutDuration}ms`);
    });
  });

  describe('💬 Critical Path 2: Chat System Flow', () => {
    it('Complete chat conversation flow', async () => {
      logger.info('🧪 Running: Complete chat conversation flow');
      
      // Step 1: Send initial message
      const message1Start = Date.now();
      const message1Response = await request(app)
        .post('/chat/send')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Hello, I need help with climate change',
          sessionId: testSessionId
        });
      const message1Duration = Date.now() - message1Start;
      
      expect(message1Response.status).toBe(200);
      expect(message1Response.body.success).toBe(true);
      expect(message1Response.body.data.messageId).toBeDefined();
      expect(message1Response.body.data.response).toBeDefined();
      
      logger.info(`✅ Initial message sent in ${message1Duration}ms`);
      
      // Step 2: Send follow-up message
      const message2Start = Date.now();
      const message2Response = await request(app)
        .post('/chat/send')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Can you provide more details about renewable energy?',
          sessionId: testSessionId
        });
      const message2Duration = Date.now() - message2Start;
      
      expect(message2Response.status).toBe(200);
      expect(message2Response.body.success).toBe(true);
      
      logger.info(`✅ Follow-up message sent in ${message2Duration}ms`);
      
      // Step 3: Get chat history
      const historyStart = Date.now();
      const historyResponse = await request(app)
        .get(`/chat/history/${testSessionId}`)
        .set('Authorization', `Bearer ${authToken}`);
      const historyDuration = Date.now() - historyStart;
      
      expect(historyResponse.status).toBe(200);
      expect(historyResponse.body.success).toBe(true);
      expect(historyResponse.body.data.messages).toBeDefined();
      expect(Array.isArray(historyResponse.body.data.messages)).toBe(true);
      expect(historyResponse.body.data.messages.length).toBeGreaterThanOrEqual(2);
      
      logger.info(`✅ Chat history retrieved in ${historyDuration}ms`);
      
      // Step 4: Generate TTS for response
      const ttsStart = Date.now();
      const ttsResponse = await request(app)
        .post('/chat/tts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          text: 'This is a test TTS message',
          sessionId: testSessionId
        });
      const ttsDuration = Date.now() - ttsStart;
      
      expect(ttsResponse.status).toBe(200);
      expect(ttsResponse.body.success).toBe(true);
      expect(ttsResponse.body.data.audioUrl).toBeDefined();
      
      logger.info(`✅ TTS generation completed in ${ttsDuration}ms`);
    });

    it('Chat session management flow', async () => {
      logger.info('🧪 Running: Chat session management flow');
      
      // Step 1: Get user sessions
      const sessionsStart = Date.now();
      const sessionsResponse = await request(app)
        .get('/chat/sessions')
        .set('Authorization', `Bearer ${authToken}`);
      const sessionsDuration = Date.now() - sessionsStart;
      
      expect(sessionsResponse.status).toBe(200);
      expect(sessionsResponse.body.success).toBe(true);
      expect(sessionsResponse.body.data.sessions).toBeDefined();
      expect(Array.isArray(sessionsResponse.body.data.sessions)).toBe(true);
      
      logger.info(`✅ User sessions retrieved in ${sessionsDuration}ms`);
      
      // Step 2: Delete session
      const deleteStart = Date.now();
      const deleteResponse = await request(app)
        .delete(`/chat/session/${testSessionId}`)
        .set('Authorization', `Bearer ${authToken}`);
      const deleteDuration = Date.now() - deleteStart;
      
      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.success).toBe(true);
      
      logger.info(`✅ Session deletion completed in ${deleteDuration}ms`);
    });
  });

  describe('📄 Critical Path 3: PDF Processing Flow', () => {
    it('Complete PDF upload and processing flow', async () => {
      logger.info('🧪 Running: Complete PDF upload and processing flow');
      
      // Step 1: Upload PDF file
      const uploadStart = Date.now();
      const uploadResponse = await request(app)
        .post('/pdf-read/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', Buffer.from('mock pdf content for regression test'), 'regression-test.pdf');
      const uploadDuration = Date.now() - uploadStart;
      
      expect(uploadResponse.status).toBe(200);
      expect(uploadResponse.body.success).toBe(true);
      expect(uploadResponse.body.data.fileId).toBeDefined();
      
      logger.info(`✅ PDF upload completed in ${uploadDuration}ms`);
      
      // Step 2: Summarize PDF
      const summarizeStart = Date.now();
      const summarizeResponse = await request(app)
        .post('/pdf-read/summarize')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          fileId: testFileId,
          options: {
            maxLength: 500,
            includeKeyPoints: true
          }
        });
      const summarizeDuration = Date.now() - summarizeStart;
      
      expect(summarizeResponse.status).toBe(200);
      expect(summarizeResponse.body.success).toBe(true);
      expect(summarizeResponse.body.data.summary).toBeDefined();
      expect(summarizeResponse.body.data.keyPoints).toBeDefined();
      
      logger.info(`✅ PDF summarization completed in ${summarizeDuration}ms`);
      
      // Step 3: Generate document from PDF
      const docStart = Date.now();
      const docResponse = await request(app)
        .post('/pdf-read/generate-doc')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          prompt: 'Create a comprehensive report based on this PDF',
          fileId: testFileId
        });
      const docDuration = Date.now() - docStart;
      
      expect(docResponse.status).toBe(200);
      expect(docResponse.body.success).toBe(true);
      expect(docResponse.body.data.documentUrl).toBeDefined();
      
      logger.info(`✅ Document generation completed in ${docDuration}ms`);
      
      // Step 4: Generate presentation from PDF
      const pptStart = Date.now();
      const pptResponse = await request(app)
        .post('/pdf-read/generate-ppt')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          prompt: 'Create a presentation based on this PDF',
          fileId: testFileId
        });
      const pptDuration = Date.now() - pptStart;
      
      expect(pptResponse.status).toBe(200);
      expect(pptResponse.body.success).toBe(true);
      expect(pptResponse.body.data.presentationUrl).toBeDefined();
      
      logger.info(`✅ Presentation generation completed in ${pptDuration}ms`);
    });

    it('PDF file management flow', async () => {
      logger.info('🧪 Running: PDF file management flow');
      
      // Step 1: Get user files
      const filesStart = Date.now();
      const filesResponse = await request(app)
        .get('/pdf-read/files')
        .set('Authorization', `Bearer ${authToken}`);
      const filesDuration = Date.now() - filesStart;
      
      expect(filesResponse.status).toBe(200);
      expect(filesResponse.body.success).toBe(true);
      expect(filesResponse.body.data.files).toBeDefined();
      expect(Array.isArray(filesResponse.body.data.files)).toBe(true);
      
      logger.info(`✅ User files retrieved in ${filesDuration}ms`);
      
      // Step 2: Delete file
      const deleteStart = Date.now();
      const deleteResponse = await request(app)
        .delete(`/pdf-read/files/${testFileId}`)
        .set('Authorization', `Bearer ${authToken}`);
      const deleteDuration = Date.now() - deleteStart;
      
      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.success).toBe(true);
      
      logger.info(`✅ File deletion completed in ${deleteDuration}ms`);
    });
  });

  describe('🔔 Critical Path 4: Notification System Flow', () => {
    it('Complete notification management flow', async () => {
      logger.info('🧪 Running: Complete notification management flow');
      
      // Step 1: Send notification
      const sendStart = Date.now();
      const sendResponse = await request(app)
        .post('/notifications/send')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          userId: testUserId,
          title: 'Regression Test Notification',
          body: 'This is a test notification for regression testing',
          type: 'info'
        });
      const sendDuration = Date.now() - sendStart;
      
      expect(sendResponse.status).toBe(200);
      expect(sendResponse.body.success).toBe(true);
      expect(sendResponse.body.data.notificationId).toBeDefined();
      
      logger.info(`✅ Notification sent in ${sendDuration}ms`);
      
      // Step 2: Get user notifications
      const getStart = Date.now();
      const getResponse = await request(app)
        .get('/notifications')
        .set('Authorization', `Bearer ${authToken}`);
      const getDuration = Date.now() - getStart;
      
      expect(getResponse.status).toBe(200);
      expect(getResponse.body.success).toBe(true);
      expect(getResponse.body.data.notifications).toBeDefined();
      expect(Array.isArray(getResponse.body.data.notifications)).toBe(true);
      
      logger.info(`✅ User notifications retrieved in ${getDuration}ms`);
      
      // Step 3: Mark notification as read
      const markReadStart = Date.now();
      const markReadResponse = await request(app)
        .put('/notifications/test-notification-id/read')
        .set('Authorization', `Bearer ${authToken}`);
      const markReadDuration = Date.now() - markReadStart;
      
      expect(markReadResponse.status).toBe(200);
      expect(markReadResponse.body.success).toBe(true);
      
      logger.info(`✅ Notification marked as read in ${markReadDuration}ms`);
      
      // Step 4: Mark all notifications as read
      const markAllStart = Date.now();
      const markAllResponse = await request(app)
        .post('/notifications/mark-all-read')
        .set('Authorization', `Bearer ${authToken}`);
      const markAllDuration = Date.now() - markAllStart;
      
      expect(markAllResponse.status).toBe(200);
      expect(markAllResponse.body.success).toBe(true);
      expect(markAllResponse.body.data.updatedCount).toBeDefined();
      
      logger.info(`✅ All notifications marked as read in ${markAllDuration}ms`);
      
      // Step 5: Delete notification
      const deleteStart = Date.now();
      const deleteResponse = await request(app)
        .delete('/notifications/test-notification-id')
        .set('Authorization', `Bearer ${authToken}`);
      const deleteDuration = Date.now() - deleteStart;
      
      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.success).toBe(true);
      
      logger.info(`✅ Notification deletion completed in ${deleteDuration}ms`);
    });
  });

  describe('🔄 Critical Path 5: End-to-End Integration Flow', () => {
    it('Complete user journey from registration to content creation', async () => {
      logger.info('🧪 Running: Complete user journey from registration to content creation');
      
      const journeyStart = Date.now();
      
      // Step 1: User registration
      const registerResponse = await request(app)
        .post('/auth/register')
        .send({
          email: 'e2e@example.com',
          password: 'E2ETest123!',
          firstName: 'E2E',
          lastName: 'Test'
        });
      
      expect(registerResponse.status).toBe(201);
      expect(registerResponse.body.success).toBe(true);
      
      logger.info('✅ Step 1: User registration completed');
      
      // Step 2: User login
      const loginResponse = await request(app)
        .post('/auth/login')
        .send({
          email: 'e2e@example.com',
          password: 'E2ETest123!'
        });
      
      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body.success).toBe(true);
      
      const userToken = loginResponse.body.data.tokens.accessToken;
      logger.info('✅ Step 2: User login completed');
      
      // Step 3: Start chat conversation
      const chatResponse = await request(app)
        .post('/chat/send')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          message: 'I want to create a presentation about renewable energy',
          sessionId: 'e2e-session-123'
        });
      
      expect(chatResponse.status).toBe(200);
      expect(chatResponse.body.success).toBe(true);
      
      logger.info('✅ Step 3: Chat conversation started');
      
      // Step 4: Upload PDF for analysis
      const uploadResponse = await request(app)
        .post('/pdf-read/upload')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('file', Buffer.from('mock pdf content for e2e test'), 'e2e-test.pdf');
      
      expect(uploadResponse.status).toBe(200);
      expect(uploadResponse.body.success).toBe(true);
      
      logger.info('✅ Step 4: PDF uploaded for analysis');
      
      // Step 5: Send notification about completion
      const notificationResponse = await request(app)
        .post('/notifications/send')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          userId: 'e2e-user-123',
          title: 'Presentation Ready',
          body: 'Your renewable energy presentation has been generated successfully!',
          type: 'success'
        });
      
      expect(notificationResponse.status).toBe(200);
      expect(notificationResponse.body.success).toBe(true);
      
      logger.info('✅ Step 5: Completion notification sent');
      
      const journeyDuration = Date.now() - journeyStart;
      logger.info(`🎉 Complete E2E journey completed in ${journeyDuration}ms`);
    });
  });
});








