import { beforeAll, afterAll, jest } from '@jest/globals';
import 'dotenv/config';
import { logger } from '../src/utils/logger';

// Set test environment variables FIRST - before any imports
process.env.NODE_ENV = 'test';
process.env.JWT_HS_SECRET = 'test-secret-key-for-testing-only';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = 'test@test-project.iam.gserviceaccount.com';
// Use a simpler mock approach - don't try to use real private key
process.env.FIREBASE_PRIVATE_KEY = 'mock-private-key-for-testing';
process.env.USE_FIREBASE_EMULATOR = 'true'; // Signal to use emulator/mock

// Mock Firestore operations with proper types
const mockBatch = {
  set: jest.fn().mockReturnThis() as any,
  update: jest.fn().mockReturnThis() as any,
  delete: jest.fn().mockReturnThis() as any,
  commit: jest.fn().mockResolvedValue(undefined) as any,
};

const mockDocRef: any = {
  get: jest.fn().mockResolvedValue({
    exists: false,
    data: () => ({}),
    id: 'test-doc-id',
  }),
  set: jest.fn().mockResolvedValue(undefined),
  update: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(undefined),
  collection: jest.fn(),
};

const mockCollectionRef: any = {
  doc: jest.fn(() => mockDocRef),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  get: jest.fn().mockResolvedValue({
    docs: [],
    empty: true,
    size: 0,
  }),
  add: jest.fn().mockResolvedValue(mockDocRef),
};

const mockFirestore: any = {
  collection: jest.fn(() => mockCollectionRef),
  batch: jest.fn(() => mockBatch),
  runTransaction: jest.fn((callback: any) => callback({
    get: mockDocRef.get,
    set: mockDocRef.set,
    update: mockDocRef.update,
    delete: mockDocRef.delete,
  })),
};

// Mock Firebase Admin
jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  credential: {
    cert: jest.fn(() => ({})),
  },
  firestore: jest.fn(() => mockFirestore),
}));

// Mock Redis with proper types
const mockRedis: any = {
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
export { mockFirestore, mockRedis, mockDocRef, mockCollectionRef, mockBatch };

beforeAll(async () => {
  logger.info('🧪 Setting up test environment...');
  logger.info('✅ Firebase Admin mocked');
  logger.info('✅ Redis mocked');
  logger.info('✅ Test environment variables set');
});

afterAll(async () => {
  logger.info('🧹 Cleaning up test environment...');
  jest.clearAllMocks();
});
