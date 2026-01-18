require('dotenv/config');
const { logger } = require('../src/utils/logger');

// Set test environment variables FIRST - before any imports
process.env.NODE_ENV = 'test';
process.env.JWT_HS_SECRET = 'test-secret-key-for-testing-only';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = 'test@test-project.iam.gserviceaccount.com';
process.env.FIREBASE_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCQ7vDlOXc2e0Lo
TAb12nAfisP6JsJ3mk71apFn1BOcvEl+zpq1w23cXIA0Fjktzo6Wdhfzj9MhUNn3
tMAW7DYiAfigK5LcLLEaEG2BKzfAdi6X9ETPulFcVaeJ3RteqyxS+UeCc83cukI5
5MmC14mxY7mQ7tkHU1ddqWpjvnSFkB5cm6ROjBOOMZ2JlZ1+RPrXkUzIf2gcx4vw
cvci8vuJWxOCefyQ0Xhrql6siEWw4Y6R3vN+BMDibpQAsv/TxmoD0XQtdGFOxjlN
OVJh+M6dPvdfvO8jtz7+1jbwXzn1/QGhwftPBuyh0V5a0Pe+aZwiZ+QUz3RuhtJa
hPTlf7xtAgMBAAECggEAKjPhoqXioFMxLupghnuWdaDXI0LhEqm0v0LKV3UKRvQO
5KVtqGrhVS78R+6GtN92Zrq5i7tAK+3aooYX/zTGKI3xY1Z8268J3QCWmmvGvrzL
IYVH+kMTSPNKJ1tiimUGsZyT5ZkqA1GbUjdcNETl++kBkoHyYW8zu/rGl4fQb0mR
V7vO9/z/zol0GuF6MIK5OGz694UnuhbTf425CBR6Fa1Ja6Mbta+GE8mkMUxS6wpH
DYu4seHAwJMe8UkSY9opebtY2KXzdjj2ZNsarIApG35BWk0BCPOoIhYz2CZb/mB7
mncl2KTmgxj+NjSjJzZNhgMXjXRvDWmlHseB46xL4wKBgQDBOsNooWeQ2HRP3Ilj
ZpubVrUFuLsRclsYh8lWvLpjs+mK3XLvdYgTfJee2uWXmr1Y02ETcBRFjiXufUT5
hxM7TAbAs6ZN3fAVwEqA9HouDIoKKJcUhv5+5685qinkSLP88lGX+7Jv3syUY4d7
bw6emd7J0+PxyZlrQVKdW9/b/wKBgQDAA8zjY9hPmyQqaS55ShUAx6rb8eksDPDR
yi9KL3tuBlJgcsuzJLo/teWP4dVign1WDkyIWPmyJOXfp3K5X7U5TbeaqlJzdgkj
3kJ8P93dFyhgOBosA2waqdZ+xMRSAvH/SVzrRe6e2UDo24AedLIn93Ql21ElnXrC
j6Iyys+XkwKBgC2kK7PzK/tSpWaXuPv5qJewi2GmmMkuMcZBjJUoTv5t6KQcWqGl
KVcw/r9PBRwiOMdaZnuo5aDoSp1iiYBHH4vKEW5DAO0zlxoMKYz8Mj/eRlzP6Z+3
ozVmlEUSpIJ/icQdmJhFo4g5ICmMuNu3B8T+o1kY66aY79wdud3hbacRAoGAStxw
cisIN6klxX8yhkkyvRYbcBr1rJ3y+efY3hR7C99dGItJDbQBBTvWn20Ns5VqZjW2
8uW1nBW0paj0Gn/M+OVq8tr6wFdBowFRbH298yfHLxRQZ96BtDeJD+2JGOxbCwvA
NV4TdU0AeIizf6xBlUFtwCCsl3y5UseLFkBqBQ8CgYEAuLp9doV56vEuZje6iEbD
ICxrO0+6Rza6+7NsGCXsmdlYrP7QBovH0CjI5qurIUKr+Cs/99Y6H/UMCR6SJeF9
C+HjodyFXG1IBtmI2ScPJHcd2QJaGX8Oq5w+UQWwnmVUR8dmj7/vOHPFR+DToxyq
b8x84mC0VPthv1xveEo//Bc=
-----END PRIVATE KEY-----`;

// Mock Redis BEFORE imports
const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  keys: jest.fn().mockResolvedValue([]),
  quit: jest.fn().mockResolvedValue('OK'),
  disconnect: jest.fn(),
  on: jest.fn(),
};

jest.mock('ioredis', () => {
  return jest.fn(() => mockRedis);
});

// Export mocks for use in tests
module.exports = {
  mockRedis,
};

beforeAll(async () => {
  logger.info('🧪 Setting up test environment...');
  
  // Initialize Firebase Admin with valid test credentials
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY,
      }),
    });
    logger.info('✅ Firebase Admin initialized for testing');
  }

  logger.info('✅ Redis mocked');
  logger.info('✅ Test environment variables set');
});

afterAll(async () => {
  logger.info('🧹 Cleaning up test environment...');
  
  // Clean up Firebase app
  const admin = require('firebase-admin');
  if (admin.apps.length > 0) {
    await Promise.all(admin.apps.map((app) => app?.delete()));
  }
  
  jest.clearAllMocks();
});
