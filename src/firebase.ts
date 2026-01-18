import { logger } from './utils/logger';
import * as firebaseAdmin from 'firebase-admin';

// Initialize Firebase Admin SDK
if (!firebaseAdmin.apps.length) {
  try {
    // Try to initialize with service account
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY 
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
      : null;

    const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || 'aveniaapp.firebasestorage.app';

    if (serviceAccount) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
        storageBucket,
      });
      logger.info('Firebase Admin SDK initialized with service account');
    } else {
      // Fallback to default credentials (for local development)
      firebaseAdmin.initializeApp({ storageBucket });
      logger.info('Firebase Admin SDK initialized with default credentials');
    }
  } catch (error) {
    logger.error('Failed to initialize Firebase Admin SDK:', error);
    logger.warn('Falling back to mock Firebase for development');
  }
}

type DocumentData = Record<string, any>;

interface Filter {
  field: string;
  operator: string;
  value: any;
}

interface QueryOptions {
  filters: Filter[];
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
}

const collections = new Map<string, Map<string, DocumentData>>();

const randomId = () => `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

function getCollectionStore(name: string): Map<string, DocumentData> {
  if (!collections.has(name)) {
    collections.set(name, new Map());
  }
  return collections.get(name)!;
}

function getFieldValue(data: DocumentData, field: string): any {
  return field.split('.').reduce((value: any, part: string) => (value ? value[part] : undefined), data);
}

function matchesFilter(data: DocumentData, filter: Filter): boolean {
  const fieldValue = getFieldValue(data, filter.field);
  switch (filter.operator) {
    case '==':
      if (filter.value === null) {
        return fieldValue === null || fieldValue === undefined;
      }
      return fieldValue === filter.value;
    case '!=':
      return fieldValue !== filter.value;
    case '>':
      return fieldValue > filter.value;
    case '>=':
      return fieldValue >= filter.value;
    case '<':
      return fieldValue < filter.value;
    case '<=':
      return fieldValue <= filter.value;
    default:
      return false;
  }
}

function sortDocuments(
  docs: Array<{ id: string; data: DocumentData }>,
  orderBy?: { field: string; direction: 'asc' | 'desc' }
) {
  if (!orderBy) {
    return docs;
  }

  return docs.sort((a, b) => {
    const aValue = getFieldValue(a.data, orderBy.field);
    const bValue = getFieldValue(b.data, orderBy.field);

    if (aValue === bValue) {
      return 0;
    }

    const direction = orderBy.direction === 'desc' ? -1 : 1;
    return aValue > bValue ? direction : -direction;
  });
}

function logDocAction(action: string, collectionName: string, docId: string, data?: DocumentData) {
  const path = `${collectionName}/${docId}`;
  const message = `Mock Firebase: ${action} document ${path}`;
  if (data !== undefined) {
    logger.debug({ collection: collectionName, docId, data }, message);
  } else {
    logger.debug({ collection: collectionName, docId }, message);
  }
}

function createQuery(collectionName: string, options: QueryOptions = { filters: [] }) {
  return {
    where(field: string, operator: string, value: any) {
      return createQuery(collectionName, {
        ...options,
        filters: [...options.filters, { field, operator, value }]
      });
    },
    orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
      return createQuery(collectionName, {
        ...options,
        orderBy: { field, direction }
      });
    },
    limit(count: number) {
      return createQuery(collectionName, {
        ...options,
        limit: count
      });
    },
    offset(count: number) {
      return createQuery(collectionName, {
        ...options,
        offset: count
      });
    },
    async get() {
      const store = getCollectionStore(collectionName);
      let docs = Array.from(store.entries()).map(([id, data]) => ({ id, data }));

      if (options.filters.length > 0) {
        docs = docs.filter(({ data }) => options.filters.every(filter => matchesFilter(data, filter)));
      }

      docs = sortDocuments(docs, options.orderBy);

      if (options.offset && options.offset > 0) {
        docs = docs.slice(options.offset);
      }

      if (options.limit !== undefined) {
        docs = docs.slice(0, options.limit);
      }

      logger.debug({ collection: collectionName, options }, 'Mock Firebase: query get');

      const snapshots = docs.map(({ id, data }) => ({
        id,
        exists: true,
        data: () => ({ ...data }),
        ref: createDocRef(collectionName, id)
      }));

      return {
        empty: snapshots.length === 0,
        size: snapshots.length,
        docs: snapshots,
        forEach(callback: (doc: any) => void) {
          snapshots.forEach(callback);
        }
      };
    }
  };
}

function createDocRef(collectionName: string, docId: string) {
  return {
    id: docId,
    collectionName,
    async set(data: DocumentData): Promise<void> {
      const store = getCollectionStore(collectionName);
      logDocAction('set', collectionName, docId, data);
      store.set(docId, { ...data });
    },
    async get() {
      const store = getCollectionStore(collectionName);
      const data = store.get(docId);
      const exists = data !== undefined;
      logger.debug({ collection: collectionName, docId, exists }, 'Mock Firebase: get document');
      return {
        id: docId,
        exists,
        data: () => (exists ? { ...data! } : undefined),
        ref: createDocRef(collectionName, docId)
      };
    },
    async update(data: DocumentData): Promise<void> {
      const store = getCollectionStore(collectionName);
      const existing = store.get(docId);
      if (!existing) {
        throw new Error(`Document ${docId} does not exist in collection ${collectionName}`);
      }
      logDocAction('update', collectionName, docId, data);
      store.set(docId, { ...existing, ...data });
    },
    async delete(): Promise<void> {
      const store = getCollectionStore(collectionName);
      logDocAction('delete', collectionName, docId);
      store.delete(docId);
    },
    collection(subName: string) {
      return createCollection(`${collectionName}/${docId}/${subName}`);
    }
  };
}

function createCollection(collectionName: string) {
  return {
    doc(id?: string) {
      const docId = id || randomId();
      return createDocRef(collectionName, docId);
    },
    async add(data: DocumentData) {
      const docId = randomId();
      logger.debug({ collection: collectionName, docId, data }, 'Mock Firebase: add document');
      await createDocRef(collectionName, docId).set(data);
      return { id: docId };
    },
    where(field: string, operator: string, value: any) {
      return createQuery(collectionName, { filters: [{ field, operator, value }] });
    },
    orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
      return createQuery(collectionName, { filters: [], orderBy: { field, direction } });
    },
    async get() {
      return createQuery(collectionName, { filters: [] }).get();
    }
  };
}

const mockFirestore = () => ({
  collection: (name: string) => createCollection(name),
  batch: () => ({
    async set(docRef: any, data: DocumentData) {
      logger.debug({ data }, 'Mock Firebase: batch set document');
      await docRef.set(data);
    },
    async update(docRef: any, data: DocumentData) {
      logger.debug({ data }, 'Mock Firebase: batch update document');
      await docRef.update(data);
    },
    async delete(docRef: any) {
      logger.debug('Mock Firebase: batch delete document');
      await docRef.delete();
    },
    async commit() {
      logger.debug('Mock Firebase: batch commit');
    }
  }),
  async recursiveDelete(target: any) {
    logger.debug({ target }, 'Mock Firebase: recursive delete invoked');
    return 0;
  }
});

// db is now exported above

export const firestoreQuery = {
  where: () => firestoreQuery,
  orderBy: () => firestoreQuery,
  limit: () => firestoreQuery,
  offset: () => firestoreQuery,
  async get() {
    logger.debug('Mock Firebase: empty query get');
    return {
      empty: true,
      size: 0,
      docs: [],
      forEach: () => {}
    };
  }
} as any;

interface MockUserRecord {
  uid: string;
  email?: string;
  displayName?: string;
  emailVerified?: boolean;
  disabled?: boolean;
}

const authUsers = new Map<string, MockUserRecord>();

const mockStorage = () => ({
  bucket() {
    return {
      async deleteFiles(options?: { prefix?: string }) {
        logger.debug({ options }, 'Mock Firebase: deleteFiles called');
      },
      file(path: string) {
        return {
          async delete() {
            logger.debug({ path }, 'Mock Firebase: file delete called');
          },
          async exists() {
            logger.debug({ path }, 'Mock Firebase: file exists check');
            return [false];
          },
          async getFiles() {
            logger.debug({ path }, 'Mock Firebase: getFiles under prefix');
            return [[]];
          }
        };
      },
      async getFiles(options?: { prefix?: string }) {
        logger.debug({ options }, 'Mock Firebase: bucket getFiles');
        return [[]];
      }
    };
  }
});

const mockAuth = () => ({
  async getUser(uid: string) {
    const user = authUsers.get(uid);
    if (!user) {
      throw Object.assign(new Error(`User ${uid} not found`), { code: 'auth/user-not-found' });
    }
    logger.debug({ uid }, 'Mock Firebase Auth: getUser');
    return { ...user };
  },
  async getUserByEmail(email: string) {
    const found = Array.from(authUsers.values()).find(user => user.email === email);
    if (!found) {
      throw Object.assign(new Error(`User with email ${email} not found`), { code: 'auth/user-not-found' });
    }
    logger.debug({ email }, 'Mock Firebase Auth: getUserByEmail');
    return { ...found };
  },
  async createUser(data: Partial<MockUserRecord>) {
    const uid = data.uid || randomId();
    if (data.email) {
      const existing = Array.from(authUsers.values()).find(user => user.email === data.email);
      if (existing) {
        throw Object.assign(new Error(`Email ${data.email} already exists`), { code: 'auth/email-already-exists' });
      }
    }
    const record: MockUserRecord = {
      uid,
      email: data.email,
      displayName: data.displayName,
      emailVerified: data.emailVerified ?? false,
      disabled: data.disabled ?? false
    };
    authUsers.set(uid, record);
    logger.debug({ uid, email: record.email }, 'Mock Firebase Auth: createUser');
    return { ...record };
  },
  async updateUser(uid: string, data: Partial<MockUserRecord>) {
    const existing = authUsers.get(uid);
    if (!existing) {
      throw Object.assign(new Error(`User ${uid} not found`), { code: 'auth/user-not-found' });
    }
    const updated: MockUserRecord = {
      ...existing,
      ...data,
      uid
    };
    authUsers.set(uid, updated);
    logger.debug({ uid }, 'Mock Firebase Auth: updateUser');
    return { ...updated };
  },
  async deleteUser(uid: string) {
    authUsers.delete(uid);
    logger.debug({ uid }, 'Mock Firebase Auth: deleteUser');
  },
  async createCustomToken(uid: string, developerClaims?: Record<string, unknown>) {
    logger.debug({ uid, developerClaims }, 'Mock Firebase Auth: createCustomToken');
    return `mock_custom_token_${uid}`;
  }
});

const mockMessaging = () => ({
  async send(message: any) {
    logger.debug({ message }, 'Mock Firebase Messaging: send');
    return 'mock_message_id';
  }
});

// Use real Firebase Admin SDK if available, otherwise fallback to mock
const isFirebaseInitialized = firebaseAdmin.apps.length > 0;

export const admin = {
  auth: () => isFirebaseInitialized ? firebaseAdmin.auth() : mockAuth(),
  firestore: () => isFirebaseInitialized ? firebaseAdmin.firestore() : (mockFirestore() as any),
  storage: () => isFirebaseInitialized ? firebaseAdmin.storage() : mockStorage(),
  messaging: () => isFirebaseInitialized ? firebaseAdmin.messaging() : mockMessaging(),
};

export const FieldValue = {
  serverTimestamp: () => new Date()
};

// Export Firestore instance
export const db = admin.firestore();
export const storage = admin.storage();

