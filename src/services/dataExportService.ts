import { promisify } from 'util';
import zlib from 'zlib';
import { db, storage } from '../firebase';
import { logger } from '../utils/logger';
import { config } from '../config';
import { PersonalDataExportResult } from '../types/deleteAccount';

const gzip = promisify(zlib.gzip);

class DataExportService {
  async generateUserExport(userId: string): Promise<PersonalDataExportResult> {
    logger.info({ userId }, 'Starting data export generation');

    // 1. User profile and subscription data
    const [profile, subsc, premium] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('subsc').doc(userId).get(),
      db.collection('premiumusers').doc(userId).get(),
    ]);

    // 2. Chats (with messages if available)
    const chats = await this.fetchCollectionByField(
      'chats',
      'ownerId',
      userId,
      config.dataExport.maxChats
    );

    // Fetch messages for each chat
    const chatsWithMessages = await Promise.all(
      chats.map(async (chat) => {
        try {
          const messagesSnapshot = await db
            .collection('chats')
            .doc(chat.id)
            .collection('messages')
            .orderBy('createdAt', 'desc')
            .limit(config.dataExport.maxMessagesPerChat)
            .get();

          const messages = messagesSnapshot.docs.map(
            (doc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>) => ({
              id: doc.id,
              ...doc.data(),
            })
          );

          return {
            ...chat,
            messages,
            messageCount: messages.length,
          };
        } catch (error) {
          logger.warn({ err: error, chatId: chat.id }, 'Failed to fetch messages for chat');
          return {
            ...chat,
            messages: [],
            messageCount: 0,
          };
        }
      })
    );

    // 3. Sessions
    const sessions = await this.fetchCollectionByField(
      'sessions',
      'userId',
      userId,
      config.dataExport.maxSessions
    );

    // 4. Recent Tasks
    const recentTasks = await this.fetchCollectionByField(
      'recentTasks',
      'userId',
      userId,
      config.dataExport.maxSessions || 100
    );

    // 5. Device Tokens
    const deviceTokens = await this.fetchCollectionByField(
      'deviceTokens',
      'userId',
      userId,
      50
    );

    // Also check if there's a document with userId as doc ID
    try {
      const deviceTokenDoc = await db.collection('deviceTokens').doc(userId).get();
      if (deviceTokenDoc.exists && !deviceTokens.find((t) => t.id === userId)) {
        deviceTokens.push({
          id: deviceTokenDoc.id,
          ...deviceTokenDoc.data(),
        });
      }
    } catch (error) {
      logger.warn({ err: error }, 'Failed to fetch deviceTokens document');
    }

    // 6. Push Tokens
    const pushTokens = await this.fetchCollectionByField(
      'pushTokens',
      'userId',
      userId,
      50
    );

    // Also check if there's a document with userId as doc ID
    try {
      const pushTokenDoc = await db.collection('pushTokens').doc(userId).get();
      if (pushTokenDoc.exists && !pushTokens.find((t) => t.id === userId)) {
        pushTokens.push({
          id: pushTokenDoc.id,
          ...pushTokenDoc.data(),
        });
      }
    } catch (error) {
      logger.warn({ err: error }, 'Failed to fetch pushTokens document');
    }

    // 7. Messages subcollection (messages/{userId}/...)
    let messagesFromSubcollection: any[] = [];
    try {
      const messagesRef = db.collection('messages').doc(userId);
      const docSnapshot = await messagesRef.get();
      
      if (docSnapshot.exists) {
        // Try to list subcollections
        try {
          const subcollections = await messagesRef.listCollections();
          
          for (const subcollection of subcollections) {
            const snapshot = await subcollection
              .limit(config.dataExport.maxMessagesPerChat || 1000)
              .get();
            
            messagesFromSubcollection.push(
              ...snapshot.docs.map(
                (doc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>) => ({
                  id: doc.id,
                  subcollection: subcollection.id,
                  ...doc.data(),
                })
              )
            );
          }
        } catch (subcollectionError) {
          // If listCollections fails, try direct collection access
          logger.debug({ err: subcollectionError }, 'listCollections failed, trying direct access');
        }
      }
    } catch (error) {
      logger.warn({ err: error }, 'Failed to fetch messages subcollection');
    }

    // 8. Storage metadata (file list, not actual files)
    const storageMetadata = await this.fetchStorageMetadata(userId);

    const exportPayload = {
      generatedAt: new Date().toISOString(),
      userId,
      exportVersion: '1.0',
      summary: {
        profile: profile.exists,
        subscription: subsc.exists,
        premium: premium.exists,
        chatsCount: chatsWithMessages.length,
        sessionsCount: sessions.length,
        recentTasksCount: recentTasks.length,
        deviceTokensCount: deviceTokens.length,
        pushTokensCount: pushTokens.length,
        messagesFromSubcollectionCount: messagesFromSubcollection.length,
        storageFilesCount: storageMetadata.files.length,
      },
      data: {
        profile: profile.exists ? profile.data() : null,
        subscription: subsc.exists ? subsc.data() : null,
        premium: premium.exists ? premium.data() : null,
        chats: chatsWithMessages,
        sessions,
        recentTasks,
        deviceTokens,
        pushTokens,
        messagesFromSubcollection,
        storageMetadata,
      },
    };

    const serialized = Buffer.from(JSON.stringify(exportPayload, null, 2), 'utf-8');
    const compressed = await gzip(serialized);

    const fileName = `avenia-export-${userId}-${Date.now()}.json.gz`;

    logger.info(
      {
        userId,
        size: compressed.length,
        uncompressedSize: serialized.length,
        summary: exportPayload.summary,
      },
      'Generated personal data export archive'
    );

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    return {
      archiveBase64: compressed.toString('base64'),
      fileName,
      size: compressed.length,
      generatedAt: exportPayload.generatedAt,
      expiresAt,
    };
  }

  private async fetchCollectionByField(
    collection: string,
    field: string,
    value: string,
    limit: number
  ): Promise<any[]> {
    try {
      const snapshot = await db
        .collection(collection)
        .where(field, '==', value)
        .limit(limit)
        .get();

      return snapshot.docs.map(
        (
          doc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>
        ) => ({
        id: doc.id,
        ...doc.data(),
        })
      );
    } catch (error) {
      logger.error(
        { err: error, collection, field },
        'Failed to fetch collection for data export'
      );
      return [];
    }
  }

  private async fetchStorageMetadata(userId: string): Promise<{
    files: Array<{
      path: string;
      name: string;
      size?: number;
      contentType?: string;
      timeCreated?: string;
      updated?: string;
    }>;
    prefixes: string[];
  }> {
    const files: Array<{
      path: string;
      name: string;
      size?: number;
      contentType?: string;
      timeCreated?: string;
      updated?: string;
    }> = [];
    const prefixes: string[] = [];

    try {
      const bucket = storage.bucket();
      const prefixesToCheck = [
        `uploads/${userId}`,
        `history/${userId}`,
        `profileImages/${userId}`,
        `tempFiles/${userId}`,
      ];

      for (const prefix of prefixesToCheck) {
        try {
          const [fileList] = await bucket.getFiles({ prefix, maxResults: 1000 });
          
          for (const file of fileList) {
            const [metadata] = await file.getMetadata().catch(() => [null]);
            const metadataSize = metadata?.size;
            files.push({
              path: file.name,
              name: file.name.split('/').pop() || file.name,
              size: metadataSize
                ? typeof metadataSize === 'string'
                  ? parseInt(metadataSize, 10)
                  : typeof metadataSize === 'number'
                  ? metadataSize
                  : undefined
                : undefined,
              contentType: metadata?.contentType,
              timeCreated: metadata?.timeCreated,
              updated: metadata?.updated,
            });
          }

          // Check for subdirectories
          const [subdirs, , apiResponse] = await bucket.getFiles({ prefix, delimiter: '/', maxResults: 1000 });
          const subdirPrefixes = (apiResponse as any)?.prefixes || [];
          for (const subdir of subdirPrefixes) {
            if (typeof subdir === 'string' && !prefixes.includes(subdir)) {
              prefixes.push(subdir);
            }
          }
        } catch (error) {
          logger.warn({ err: error, prefix }, 'Failed to fetch storage files for prefix');
        }
      }
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to fetch storage metadata');
    }

    return { files, prefixes };
  }
}

export const dataExportService = new DataExportService();

