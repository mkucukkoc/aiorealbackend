// import { getFirestore } from 'firebase-admin/firestore';
// import { getStorage } from 'firebase-admin/storage';
import { logger } from '../utils/logger';
import { cacheService } from './cacheService';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

export interface BackupConfig {
  enabled: boolean;
  schedule: string; // cron expression
  retentionDays: number;
  storageType: 'local' | 'gcs' | 's3';
  compression: boolean;
  encryption: boolean;
  collections: string[];
  excludeCollections: string[];
}

export interface BackupResult {
  success: boolean;
  backupId: string;
  timestamp: Date;
  size: number;
  collections: string[];
  duration: number;
  error?: string;
}

class BackupService {
  private static instance: BackupService;
  private config: BackupConfig;
  private firestore: any;
  private storage: any;
  private backupPath: string;

  private constructor() {
    this.config = {
      enabled: process.env.BACKUP_ENABLED === 'true',
      schedule: process.env.BACKUP_SCHEDULE || '0 2 * * *', // Daily at 2 AM
      retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || '30'),
      storageType: (process.env.BACKUP_STORAGE_TYPE as any) || 'local',
      compression: process.env.BACKUP_COMPRESSION === 'true',
      encryption: process.env.BACKUP_ENCRYPTION === 'true',
      collections: process.env.BACKUP_COLLECTIONS?.split(',') || [],
      excludeCollections: process.env.BACKUP_EXCLUDE_COLLECTIONS?.split(',') || ['_test', '_health'],
    };

    // Mock Firebase services for testing
    this.firestore = null as any;
    this.storage = null as any;
    this.backupPath = process.env.BACKUP_PATH || './backups';
  }

  public static getInstance(): BackupService {
    if (!BackupService.instance) {
      BackupService.instance = new BackupService();
    }
    return BackupService.instance;
  }

  // Full database backup
  public async createFullBackup(): Promise<BackupResult> {
    const startTime = Date.now();
    const backupId = `backup_${Date.now()}`;
    const timestamp = new Date();

    try {
      logger.info(`Starting full backup: ${backupId}`);

      // Create backup directory
      const backupDir = path.join(this.backupPath, backupId);
      await this.ensureDirectoryExists(backupDir);

      // Get all collections
      const collections = await this.getCollectionsToBackup();
      logger.info(`Backing up ${collections.length} collections`);

      // Backup each collection
      const backupResults = await Promise.all(
        collections.map(collection => this.backupCollection(collection, backupDir))
      );

      // Create backup manifest
      const manifest = {
        backupId,
        timestamp: timestamp.toISOString(),
        collections: backupResults,
        totalDocuments: backupResults.reduce((sum, result) => sum + result.documentCount, 0),
        config: this.config,
      };

      const manifestPath = path.join(backupDir, 'manifest.json');
      await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      // Compress backup if enabled
      let finalPath = backupDir;
      if (this.config.compression) {
        finalPath = await this.compressBackup(backupDir);
      }

      // Encrypt backup if enabled
      if (this.config.encryption) {
        finalPath = await this.encryptBackup(finalPath);
      }

      // Upload to cloud storage if configured
      if (this.config.storageType !== 'local') {
        await this.uploadToCloudStorage(finalPath, backupId);
      }

      // Calculate backup size
      const stats = await fs.promises.stat(finalPath);
      const size = stats.isDirectory() ? await this.getDirectorySize(finalPath) : stats.size;

      const duration = Date.now() - startTime;
      const result: BackupResult = {
        success: true,
        backupId,
        timestamp,
        size,
        collections: collections,
        duration,
      };

      logger.info(`Backup completed successfully: ${backupId}`, {
        size: this.formatBytes(size),
        duration: `${duration}ms`,
        collections: collections.length,
      });

      // Store backup metadata in cache
      await cacheService.set(`backup:${backupId}`, result, 86400 * this.config.retentionDays);

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Backup failed: ${backupId}`, error);

      return {
        success: false,
        backupId,
        timestamp,
        size: 0,
        collections: [],
        duration,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Incremental backup (only changed documents)
  public async createIncrementalBackup(lastBackupTime: Date): Promise<BackupResult> {
    const startTime = Date.now();
    const backupId = `incremental_${Date.now()}`;
    const timestamp = new Date();

    try {
      logger.info(`Starting incremental backup: ${backupId}`);

      const backupDir = path.join(this.backupPath, backupId);
      await this.ensureDirectoryExists(backupDir);

      const collections = await this.getCollectionsToBackup();
      const backupResults = [];

      for (const collection of collections) {
        // Query documents modified since last backup
        const query = this.firestore
          .collection(collection)
          .where('updated_at', '>=', lastBackupTime)
          .orderBy('updated_at');

        const snapshot = await query.get();
        
        if (!snapshot.empty) {
          const result = await this.backupCollection(collection, backupDir, snapshot);
          backupResults.push(result);
        }
      }

      const manifest = {
        backupId,
        timestamp: timestamp.toISOString(),
        type: 'incremental',
        lastBackupTime: lastBackupTime.toISOString(),
        collections: backupResults,
        totalDocuments: backupResults.reduce((sum, result) => sum + result.documentCount, 0),
      };

      const manifestPath = path.join(backupDir, 'manifest.json');
      await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      const stats = await fs.promises.stat(backupDir);
      const size = await this.getDirectorySize(backupDir);
      const duration = Date.now() - startTime;

      const result: BackupResult = {
        success: true,
        backupId,
        timestamp,
        size,
        collections: collections,
        duration,
      };

      logger.info(`Incremental backup completed: ${backupId}`, {
        size: this.formatBytes(size),
        duration: `${duration}ms`,
        documents: backupResults.reduce((sum, r) => sum + r.documentCount, 0),
      });

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Incremental backup failed: ${backupId}`, error);

      return {
        success: false,
        backupId,
        timestamp,
        size: 0,
        collections: [],
        duration,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Restore from backup
  public async restoreFromBackup(backupId: string, collections?: string[]): Promise<boolean> {
    try {
      logger.info(`Starting restore from backup: ${backupId}`);

      const backupDir = path.join(this.backupPath, backupId);
      
      // Check if backup exists
      if (!await this.directoryExists(backupDir)) {
        throw new Error(`Backup not found: ${backupId}`);
      }

      // Read manifest
      const manifestPath = path.join(backupDir, 'manifest.json');
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));

      const collectionsToRestore = collections || manifest.collections;
      
      for (const collection of collectionsToRestore) {
        const collectionDir = path.join(backupDir, collection);
        
        if (await this.directoryExists(collectionDir)) {
          await this.restoreCollection(collection, collectionDir);
        }
      }

      logger.info(`Restore completed successfully: ${backupId}`);
      return true;

    } catch (error) {
      logger.error(`Restore failed: ${backupId}`, error);
      return false;
    }
  }

  // List available backups
  public async listBackups(): Promise<BackupResult[]> {
    try {
      const backups = await cacheService.keys('backup:*');
      const results: BackupResult[] = [];

      for (const key of backups) {
        const backup = await cacheService.get<BackupResult>(key);
        if (backup) {
          results.push(backup);
        }
      }

      return results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    } catch (error) {
      logger.error('Failed to list backups:', error);
      return [];
    }
  }

  // Cleanup old backups
  public async cleanupOldBackups(): Promise<number> {
    try {
      const backups = await this.listBackups();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

      let deletedCount = 0;

      for (const backup of backups) {
        if (backup.timestamp < cutoffDate) {
          // Delete from cache
          await cacheService.del(`backup:${backup.backupId}`);

          // Delete from filesystem
          const backupDir = path.join(this.backupPath, backup.backupId);
          if (await this.directoryExists(backupDir)) {
            await fs.promises.rm(backupDir, { recursive: true });
          }

          deletedCount++;
        }
      }

      logger.info(`Cleaned up ${deletedCount} old backups`);
      return deletedCount;

    } catch (error) {
      logger.error('Backup cleanup failed:', error);
      return 0;
    }
  }

  // Private helper methods
  private async getCollectionsToBackup(): Promise<string[]> {
    if (this.config.collections.length > 0) {
      return this.config.collections;
    }

    // Get all collections from Firestore (mocked)
    const collections: string[] = [];
    logger.debug('Mock BackupService: Getting collections list');
    
    // Mock collections for testing
    const mockCollections = ['users', 'chats', 'sessions', 'audit_logs'];
    for (const collectionId of mockCollections) {
      if (!this.config.excludeCollections.includes(collectionId)) {
        collections.push(collectionId);
      }
    }

    return collections;
  }

  private async backupCollection(collection: string, backupDir: string, snapshot?: any): Promise<any> {
    const collectionDir = path.join(backupDir, collection);
    await this.ensureDirectoryExists(collectionDir);

    // Mock Firestore collection data
    logger.debug(`Mock BackupService: Backing up collection ${collection}`);
    const docsSnapshot = snapshot || { docs: [] };
    const documents = [];

    for (const doc of docsSnapshot.docs) {
      const docData = {
        id: doc.id,
        data: doc.data(),
        createdAt: doc.createTime?.toDate()?.toISOString(),
        updatedAt: doc.updateTime?.toDate()?.toISOString(),
      };

      documents.push(docData);

      // Write individual document file
      const docPath = path.join(collectionDir, `${doc.id}.json`);
      await fs.promises.writeFile(docPath, JSON.stringify(docData, null, 2));
    }

    // Write collection summary
    const summary = {
      collection,
      documentCount: documents.length,
      timestamp: new Date().toISOString(),
    };

    const summaryPath = path.join(collectionDir, '_summary.json');
    await fs.promises.writeFile(summaryPath, JSON.stringify(summary, null, 2));

    return summary;
  }

  private async restoreCollection(collection: string, collectionDir: string): Promise<void> {
    const files = await fs.promises.readdir(collectionDir);
    const docFiles = files.filter(file => file.endsWith('.json') && file !== '_summary.json');

    for (const file of docFiles) {
      const docPath = path.join(collectionDir, file);
      const docData = JSON.parse(await fs.promises.readFile(docPath, 'utf8'));

      // Mock Firestore document restoration
      logger.debug(`Mock BackupService: Restoring document ${docData.id} to collection ${collection}`);
      // await this.firestore.collection(collection).doc(docData.id).set(docData.data);
    }
  }

  private async compressBackup(backupDir: string): Promise<string> {
    const compressedPath = `${backupDir}.tar.gz`;
    
    try {
      await execAsync(`tar -czf "${compressedPath}" -C "${path.dirname(backupDir)}" "${path.basename(backupDir)}"`);
      
      // Remove original directory
      await fs.promises.rm(backupDir, { recursive: true });
      
      return compressedPath;
    } catch (error) {
      logger.error('Backup compression failed:', error);
      return backupDir;
    }
  }

  private async encryptBackup(backupPath: string): Promise<string> {
    // Simple encryption using openssl
    const encryptedPath = `${backupPath}.enc`;
    const password = process.env.BACKUP_ENCRYPTION_PASSWORD || 'default_password';

    try {
      await execAsync(`openssl enc -aes-256-cbc -salt -in "${backupPath}" -out "${encryptedPath}" -k "${password}"`);
      
      // Remove unencrypted file
      await fs.promises.unlink(backupPath);
      
      return encryptedPath;
    } catch (error) {
      logger.error('Backup encryption failed:', error);
      return backupPath;
    }
  }

  private async uploadToCloudStorage(backupPath: string, backupId: string): Promise<void> {
    if (this.config.storageType === 'gcs') {
      // Mock Google Cloud Storage upload
      logger.debug(`Mock BackupService: Uploading ${backupPath} to GCS bucket`);
      const fileName = `backups/${backupId}/${path.basename(backupPath)}`;
      
      // Mock upload - just log the action
      logger.debug(`Mock BackupService: Would upload to ${fileName}`);
    }
    // Add S3 support if needed
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if ((error as any).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stats = await fs.promises.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  private async getDirectorySize(dirPath: string): Promise<number> {
    let size = 0;
    
    const files = await fs.promises.readdir(dirPath);
    
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = await fs.promises.stat(filePath);
      
      if (stats.isDirectory()) {
        size += await this.getDirectorySize(filePath);
      } else {
        size += stats.size;
      }
    }
    
    return size;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Schedule backup
  public scheduleBackups(): void {
    if (!this.config.enabled) {
      logger.info('Backup scheduling disabled');
      return;
    }

    // This would integrate with a cron job scheduler
    logger.info(`Backups scheduled: ${this.config.schedule}`);
  }
}

// Export singleton instance
export const backupService = BackupService.getInstance();

