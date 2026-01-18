import request from 'supertest';
import { app } from '../../src/index';
import { logger } from '../../src/utils/logger';

describe('⚡ Performance Tests - Load Testing Suite', () => {
  let authToken: string;
  const testResults: any[] = [];

  beforeAll(async () => {
    logger.info('🚀 Starting Performance Load Testing Suite');
    authToken = 'mock-auth-token';
  });

  afterAll(async () => {
    logger.info('✅ Performance Load Testing Suite Completed');
    logger.info('📊 Performance Test Results Summary:');
    testResults.forEach((result, index) => {
      logger.info(`Test ${index + 1}: ${result.name} - ${result.avgResponseTime}ms avg, ${result.successRate}% success`);
    });
  });

  describe('Load Test - Auth Endpoints', () => {
    it('Concurrent Login Requests (10 users)', async () => {
      const testName = 'Concurrent Login Requests (10 users)';
      logger.info(`🧪 Running: ${testName}`);
      
      const concurrentRequests = 10;
      const promises = [];
      const startTime = Date.now();
      
      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(
          request(app)
            .post('/auth/login')
            .send({
              email: `test${i}@example.com`,
              password: 'TestPassword123!'
            })
        );
      }
      
      const results = await Promise.allSettled(promises);
      const duration = Date.now() - startTime;
      
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;
      const successRate = (successful / concurrentRequests) * 100;
      const avgResponseTime = duration / concurrentRequests;
      
      testResults.push({
        name: testName,
        concurrentRequests,
        successful,
        successRate,
        avgResponseTime,
        totalDuration: duration
      });
      
      logger.info(`✅ ${testName}: ${successful}/${concurrentRequests} successful (${successRate.toFixed(2)}%) - Avg: ${avgResponseTime.toFixed(2)}ms`);
    });

    it('Concurrent Chat Messages (20 messages)', async () => {
      const testName = 'Concurrent Chat Messages (20 messages)';
      logger.info(`🧪 Running: ${testName}`);
      
      const concurrentRequests = 20;
      const promises = [];
      const startTime = Date.now();
      
      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(
          request(app)
            .post('/chat/send')
            .set('Authorization', `Bearer ${authToken}`)
            .send({
              message: `Test message ${i}`,
              sessionId: `test-session-${i}`
            })
        );
      }
      
      const results = await Promise.allSettled(promises);
      const duration = Date.now() - startTime;
      
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;
      const successRate = (successful / concurrentRequests) * 100;
      const avgResponseTime = duration / concurrentRequests;
      
      testResults.push({
        name: testName,
        concurrentRequests,
        successful,
        successRate,
        avgResponseTime,
        totalDuration: duration
      });
      
      logger.info(`✅ ${testName}: ${successful}/${concurrentRequests} successful (${successRate.toFixed(2)}%) - Avg: ${avgResponseTime.toFixed(2)}ms`);
    });

    it('Concurrent PDF Uploads (5 files)', async () => {
      const testName = 'Concurrent PDF Uploads (5 files)';
      logger.info(`🧪 Running: ${testName}`);
      
      const concurrentRequests = 5;
      const promises = [];
      const startTime = Date.now();
      
      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(
          request(app)
            .post('/pdf-read/upload')
            .set('Authorization', `Bearer ${authToken}`)
            .attach('file', Buffer.from('mock pdf content'), `test${i}.pdf`)
        );
      }
      
      const results = await Promise.allSettled(promises);
      const duration = Date.now() - startTime;
      
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;
      const successRate = (successful / concurrentRequests) * 100;
      const avgResponseTime = duration / concurrentRequests;
      
      testResults.push({
        name: testName,
        concurrentRequests,
        successful,
        successRate,
        avgResponseTime,
        totalDuration: duration
      });
      
      logger.info(`✅ ${testName}: ${successful}/${concurrentRequests} successful (${successRate.toFixed(2)}%) - Avg: ${avgResponseTime.toFixed(2)}ms`);
    });
  });

  describe('Stress Test - High Volume', () => {
    it('High Volume Chat Messages (100 messages)', async () => {
      const testName = 'High Volume Chat Messages (100 messages)';
      logger.info(`🧪 Running: ${testName}`);
      
      const totalRequests = 100;
      const batchSize = 10;
      const promises = [];
      const startTime = Date.now();
      
      for (let batch = 0; batch < totalRequests / batchSize; batch++) {
        const batchPromises = [];
        for (let i = 0; i < batchSize; i++) {
          const messageIndex = batch * batchSize + i;
          batchPromises.push(
            request(app)
              .post('/chat/send')
              .set('Authorization', `Bearer ${authToken}`)
              .send({
                message: `High volume test message ${messageIndex}`,
                sessionId: `stress-test-session-${batch}`
              })
          );
        }
        promises.push(...batchPromises);
      }
      
      const results = await Promise.allSettled(promises);
      const duration = Date.now() - startTime;
      
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;
      const successRate = (successful / totalRequests) * 100;
      const avgResponseTime = duration / totalRequests;
      const requestsPerSecond = totalRequests / (duration / 1000);
      
      testResults.push({
        name: testName,
        totalRequests,
        successful,
        successRate,
        avgResponseTime,
        totalDuration: duration,
        requestsPerSecond
      });
      
      logger.info(`✅ ${testName}: ${successful}/${totalRequests} successful (${successRate.toFixed(2)}%) - Avg: ${avgResponseTime.toFixed(2)}ms - RPS: ${requestsPerSecond.toFixed(2)}`);
    });

    it('High Volume Auth Requests (50 registrations)', async () => {
      const testName = 'High Volume Auth Requests (50 registrations)';
      logger.info(`🧪 Running: ${testName}`);
      
      const totalRequests = 50;
      const promises = [];
      const startTime = Date.now();
      
      for (let i = 0; i < totalRequests; i++) {
        promises.push(
          request(app)
            .post('/auth/register')
            .send({
              email: `loadtest${i}@example.com`,
              password: 'TestPassword123!',
              firstName: 'Load',
              lastName: 'Test'
            })
        );
      }
      
      const results = await Promise.allSettled(promises);
      const duration = Date.now() - startTime;
      
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;
      const successRate = (successful / totalRequests) * 100;
      const avgResponseTime = duration / totalRequests;
      const requestsPerSecond = totalRequests / (duration / 1000);
      
      testResults.push({
        name: testName,
        totalRequests,
        successful,
        successRate,
        avgResponseTime,
        totalDuration: duration,
        requestsPerSecond
      });
      
      logger.info(`✅ ${testName}: ${successful}/${totalRequests} successful (${successRate.toFixed(2)}%) - Avg: ${avgResponseTime.toFixed(2)}ms - RPS: ${requestsPerSecond.toFixed(2)}`);
    });
  });

  describe('Memory Leak Test', () => {
    it('Memory Usage During Extended Operation', async () => {
      const testName = 'Memory Usage During Extended Operation';
      logger.info(`🧪 Running: ${testName}`);
      
      const iterations = 50;
      const startTime = Date.now();
      const initialMemory = process.memoryUsage();
      
      for (let i = 0; i < iterations; i++) {
        await request(app)
          .get('/auth/test-firebase')
          .expect(200);
        
        // Small delay to simulate real usage
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      const finalMemory = process.memoryUsage();
      const duration = Date.now() - startTime;
      
      const memoryIncrease = {
        rss: finalMemory.rss - initialMemory.rss,
        heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
        heapTotal: finalMemory.heapTotal - initialMemory.heapTotal,
        external: finalMemory.external - initialMemory.external
      };
      
      testResults.push({
        name: testName,
        iterations,
        duration,
        initialMemory: {
          rss: Math.round(initialMemory.rss / 1024 / 1024),
          heapUsed: Math.round(initialMemory.heapUsed / 1024 / 1024),
          heapTotal: Math.round(initialMemory.heapTotal / 1024 / 1024)
        },
        finalMemory: {
          rss: Math.round(finalMemory.rss / 1024 / 1024),
          heapUsed: Math.round(finalMemory.heapUsed / 1024 / 1024),
          heapTotal: Math.round(finalMemory.heapTotal / 1024 / 1024)
        },
        memoryIncrease: {
          rss: Math.round(memoryIncrease.rss / 1024 / 1024),
          heapUsed: Math.round(memoryIncrease.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryIncrease.heapTotal / 1024 / 1024)
        }
      });
      
      logger.info(`✅ ${testName}: ${iterations} iterations completed in ${duration}ms`);
      logger.info(`📊 Memory - Initial: ${Math.round(initialMemory.heapUsed / 1024 / 1024)}MB, Final: ${Math.round(finalMemory.heapUsed / 1024 / 1024)}MB, Increase: ${Math.round(memoryIncrease.heapUsed / 1024 / 1024)}MB`);
    });
  });

  describe('Response Time Benchmarks', () => {
    const endpoints = [
      { path: '/auth/test-firebase', method: 'GET' },
      { path: '/chat/sessions', method: 'GET', auth: true },
      { path: '/pdf-read/files', method: 'GET', auth: true },
      { path: '/notifications', method: 'GET', auth: true }
    ];

    endpoints.forEach((endpoint, index) => {
      it(`Response Time Benchmark - ${endpoint.method} ${endpoint.path}`, async () => {
        const testName = `Response Time Benchmark - ${endpoint.method} ${endpoint.path}`;
        logger.info(`🧪 Running: ${testName}`);
        
        const iterations = 10;
        const responseTimes: number[] = [];
        const startTime = Date.now();
        
        for (let i = 0; i < iterations; i++) {
          const requestStart = Date.now();
          
          let response;
          if (endpoint.method === 'GET') {
            response = await request(app)
              .get(endpoint.path)
              .set(endpoint.auth ? { 'Authorization': `Bearer ${authToken}` } : {});
          }
          
          const requestEnd = Date.now();
          responseTimes.push(requestEnd - requestStart);
          
          // Small delay between requests
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        const duration = Date.now() - startTime;
        const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
        const minResponseTime = Math.min(...responseTimes);
        const maxResponseTime = Math.max(...responseTimes);
        const p95ResponseTime = responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length * 0.95)];
        
        testResults.push({
          name: testName,
          endpoint: endpoint.path,
          method: endpoint.method,
          iterations,
          avgResponseTime,
          minResponseTime,
          maxResponseTime,
          p95ResponseTime,
          totalDuration: duration
        });
        
        logger.info(`✅ ${testName}: Avg: ${avgResponseTime.toFixed(2)}ms, Min: ${minResponseTime}ms, Max: ${maxResponseTime}ms, P95: ${p95ResponseTime}ms`);
      });
    });
  });
});








