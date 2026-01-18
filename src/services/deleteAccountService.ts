import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { admin, db, FieldValue, storage } from '../firebase';
import { logger } from '../utils/logger';
import { config } from '../config';
import {
  DeleteAccountRequestBody,
  DeleteAccountResult,
  DeleteAccountContext,
  DeletionJobPhase,
  DeletedUserRegistryRecord,
  RestoreAccountResult,
  DeletionJobStatus,
  DeleteReason,
} from '../types/deleteAccount';
import { revenueCatService, type RevenueCatCheckResult } from './revenueCatService';
import { SessionService } from './sessionService';
import { cacheService } from './cacheService';
import { auditService } from './auditService';
import { thirdPartyIntegrationService } from './thirdPartyIntegrationService';
import { notificationService, DeleteNotificationUser } from './notificationService';

type PhaseName =
  | 'preflight_checks'
  | 'soft_delete'
  | 'sessions_tokens'
  | 'firestore_cleanup'
  | 'storage_cleanup'
  | 'third_party_cleanup'
  | 'telemetry';

const DELETION_PHASES: PhaseName[] = [
  'preflight_checks',
  'soft_delete',
  'sessions_tokens',
  'firestore_cleanup',
  'storage_cleanup',
  'third_party_cleanup',
  'telemetry',
];

export class DeleteAccountError extends Error {
  code: string;
  status: number;
  details?: any;

  constructor(code: string, message: string, status = 400, details?: any) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

interface PreflightResult {
  email?: string;
  provider?: string;
  appUserId: string;
  userProfile?: Record<string, any>;
  isAlreadyDeleted: boolean;
  deletedRegistry?: DeletedUserRegistryRecord;
}

class DeleteAccountService {
  private logDirectory = config.deleteAccount.logDirectory;

  constructor() {
    this.ensureLogDirectory();
  }

  async initiateDeletion(
    userId: string,
    body: DeleteAccountRequestBody,
    context: DeleteAccountContext = {}
  ): Promise<DeleteAccountResult> {
    const now = new Date();
    const jobId = uuidv4();
    const phases = this.createPhaseTracker();
    const jobRef = db.collection('deletion_jobs').doc(jobId);
    // Clean context object - remove undefined values
    const cleanContext: any = {};
    if (context) {
      Object.keys(context).forEach((key) => {
        const value = (context as any)[key];
        if (value !== undefined && value !== null) {
          cleanContext[key] = value;
        }
      });
    }

    const deleteReason: DeleteReason | 'user_request' = body.deleteReason ?? 'user_request';

    const jobRecordBase: any = {
      id: jobId,
      userId,
      status: 'pending' as DeletionJobStatus,
      reason: deleteReason,
      skipDataExport: body.skipDataExport ?? false,
      anonymous: body.anonymous ?? false,
      initiatedFrom: body.initiatedFrom || 'user',
      restoreUntil: null as string | null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      phases,
      context: cleanContext,
      metrics: {},
    };

    // Only include reasonNote if it's provided (not undefined)
    if (body.deleteReasonNote !== undefined && body.deleteReasonNote !== null) {
      jobRecordBase.reasonNote = body.deleteReasonNote;
    }
    await jobRef.set(jobRecordBase);

    logger.info(
      {
        userId,
        jobId,
        body,
        context: cleanContext,
      },
      'Delete account job started'
    );

    const start = Date.now();
    let restoreUntil: string | undefined;
    let hasActiveSubscription = false;
    let isAnonymous = false;

    try {
      const authRecord = await this.safeGetAuthUser(userId);
      const providers = this.extractProviders(authRecord);

      const preflight = await this.runPreflightChecks(userId, body, context);
      logger.info({ userId, jobId, preflight }, 'Preflight checks completed');
      this.updatePhase(phases, 'preflight_checks', 'completed');
      await jobRef.update({ phases });

      if (preflight.isAlreadyDeleted) {
        throw new DeleteAccountError('ACCOUNT_ALREADY_DELETED', 'Account already deleted', 409);
      }

      const appUserId = preflight.appUserId;
      isAnonymous = body.anonymous === true || providers.length === 0;

      const notificationUser = this.buildNotificationUser(userId, preflight);

      if (!isAnonymous) {
        const subscriptionStatus = await this.fetchSubscriptionStatus(appUserId);
        hasActiveSubscription = Boolean(subscriptionStatus?.hasActiveSubscription);
      }

      restoreUntil = this.calculateRestoreUntil(isAnonymous);

      await this.performSoftDelete({
        userId,
        email: preflight.email || authRecord?.email,
        provider: preflight.provider || authRecord?.providerData?.[0]?.providerId,
        deleteReason,
        context,
        restoreUntil,
        jobId,
        isAnonymous,
        hasActiveSubscription,
        appUserId,
        platform: body.platform,
        userProfile: preflight.userProfile,
        deleteRequestPayload: body,
      });
      logger.info(
        {
          userId,
          jobId,
          restoreUntil,
          isAnonymous,
        },
        'Soft delete applied'
      );
      this.updatePhase(phases, 'soft_delete', 'completed');
      await jobRef.update({ phases });

      await notificationService.sendDeleteAccountStarted(notificationUser);
      await auditService.logUserAction(userId, 'delete_account_requested', {
        jobId,
        reason: deleteReason,
        ipAddress: cleanContext.ipAddress,
        userAgent: cleanContext.userAgent,
      });

      await this.revokeSessionsAndTokens(userId);
      logger.info({ userId, jobId }, 'Sessions and tokens revoked');
      this.updatePhase(phases, 'sessions_tokens', 'completed');
      await jobRef.update({ phases });

      await this.deleteFirebaseAuthAccount(userId, { hasActiveSubscription });

      const firestoreCount = await this.cleanupFirestoreData(userId);
      logger.info({ userId, jobId, firestoreCount }, 'Firestore cleanup done');
      this.updatePhase(phases, 'firestore_cleanup', 'completed');
      await jobRef.update({
        phases,
        'metrics.firestoreDocsDeleted': firestoreCount,
      });

      const storageCount = await this.cleanupStorageData(userId);
      logger.info({ userId, jobId, storageCount }, 'Storage cleanup done');
      this.updatePhase(phases, 'storage_cleanup', 'completed');
      await jobRef.update({
        phases,
        'metrics.storageObjectsDeleted': storageCount,
      });

      await this.cleanupThirdParties({
        userId,
        email: preflight.email || authRecord?.email,
        reason: deleteReason,
      });
      logger.info({ userId, jobId }, 'Third-party cleanup triggered');
      this.updatePhase(phases, 'third_party_cleanup', 'completed');
      await jobRef.update({ phases });

      await this.recordTelemetryEvent({
        userId,
        jobId,
        deleteReason,
        restoreUntil,
        durationMs: Date.now() - start,
        context: cleanContext,
        anonymous: isAnonymous,
      });
      logger.info({ userId, jobId }, 'Telemetry recorded');
      this.updatePhase(phases, 'telemetry', 'completed');
      await jobRef.update({ phases });

      const metrics = {
        firestoreDocsDeleted: firestoreCount,
        storageObjectsDeleted: storageCount,
        durationMs: Date.now() - start,
      };

      const completedAt = new Date().toISOString();
      await jobRef.update({
        status: 'completed',
        updatedAt: completedAt,
        restoreUntil: restoreUntil || null,
        phases,
        metrics,
      });

      await this.appendDeletionLog(
        `[${new Date().toISOString()}] DELETE_ACCOUNT_COMPLETED uid:${userId} job:${jobId} reason:${deleteReason}`
      );

      this.scheduleCompletionNotification(notificationUser);

      await auditService.logUserAction(userId, 'delete_account_completed', {
        jobId,
        reason: deleteReason,
      });

      const response: DeleteAccountResult = {
        jobId,
        status: 'completed',
        providersToUnlink: [],
        restoreUntil,
        message: hasActiveSubscription
          ? 'Aktif aboneliğiniz devam ediyor. Google Play aboneliğiniz iptal edildiğinde premium erişiminiz sonlandırılacaktır.'
          : 'Backend cleanup tamamlandı ve hesabınız Firebase Auth üzerinden kapatıldı.',
      };
      const jobSummary = {
        jobId,
        userId,
        anonymous: isAnonymous,
        context: cleanContext,
        reason: deleteReason,
        initiatedFrom: body.initiatedFrom || 'user',
        skipDataExport: body.skipDataExport ?? false,
        status: 'completed',
        createdAt: jobRecordBase.createdAt,
        updatedAt: completedAt,
        restoreUntil: restoreUntil || null,
        metrics,
        phases,
      };
      logger.info(jobSummary, 'Delete account job summary');
      logger.info({ userId, jobId, response }, 'Delete account job completed');
      return response;
    } catch (error) {
      logger.error({ err: error, userId, jobId }, 'Delete account job failed');
      const deleteError = this.normalizeError(error);
      this.updatePhase(phases, 'telemetry', 'failed', deleteError.message);
      await jobRef.update({
        status: 'failed',
        updatedAt: new Date().toISOString(),
        error: {
          code: deleteError.code,
          message: deleteError.message,
          details: this.sanitizeDetails(deleteError.details),
        },
        phases,
      });
      await this.appendDeletionLog(
        `[${new Date().toISOString()}] DELETE_ACCOUNT_FAILED uid:${userId} job:${jobId} code:${deleteError.code} msg:${deleteError.message}`
      );
      throw deleteError;
    }
  }

  async restoreAccount(
    userId: string,
    context: DeleteAccountContext = {}
  ): Promise<RestoreAccountResult> {
    logger.info({ userId, context }, 'Restore account service called');
    try {
      const registrySnap = await db.collection('deleted_users_subsc').doc(userId).get();
      if (!registrySnap.exists) {
        throw new DeleteAccountError('NOT_DELETED', 'Kullanıcı silinmiş değil', 404);
      }

      const registry = registrySnap.data() as DeletedUserRegistryRecord;
      if (registry.legalHold) {
        throw new DeleteAccountError('LEGAL_HOLD', 'Hesap hukuki sebeplerle kilitli', 423);
      }

      const restoreDeadline = registry.restoreExpiresAt || registry.canRestoreUntil;
      if (restoreDeadline) {
        const deadline = new Date(restoreDeadline);
        if (deadline.getTime() < Date.now()) {
          throw new DeleteAccountError('RESTORE_WINDOW_PASSED', 'Geri alma süresi dolmuş', 410);
        }
      }

      const batch = db.batch();
      const usersRef = db.collection('users').doc(userId);
      const subscRef = db.collection('subsc').doc(userId);
      const premiumRef = db.collection('premiumusers').doc(userId);
      const blacklistRef = db.collection('notification_blacklist').doc(userId);

      batch.set(
        usersRef,
        {
          isDeleted: false,
          restoredAt: FieldValue.serverTimestamp(),
          deletedAt: null,
        },
        { merge: true }
      );
      batch.set(
        subscRef,
        {
          isDeleted: false,
          premiumCancelledAt: null,
        },
        { merge: true }
      );
      batch.set(
        premiumRef,
        {
          isDeleted: false,
          blockedForWebhook: false,
        },
        { merge: true }
      );
      batch.delete(blacklistRef);

      await batch.commit();
      await db
        .collection('deleted_users_subsc')
        .doc(userId)
        .update({
          restoreCompletedAt: FieldValue.serverTimestamp(),
          blockedForWebhook: false,
        });

      await auditService.logUserAction(userId, 'delete_account_restored', {
        ip: context.ipAddress,
        userAgent: context.userAgent,
      });

      const result = {
        restored: true,
        restoredAt: new Date().toISOString(),
        message: 'Hesap başarıyla yeniden aktifleştirildi. Premium abonelikler otomatik olarak geri açılmaz.',
      };
      logger.info({ userId, result }, 'Restore account service succeeded');
      return result;
    } catch (error) {
      logger.error({ err: error, userId }, 'Restore account service failed');
      throw error;
    }
  }

  async getJob(jobId: string) {
    const doc = await db.collection('deletion_jobs').doc(jobId).get();
    if (!doc.exists) {
      return null;
    }
    return doc.data();
  }

  async getLatestJobForUser(userId: string) {
    const snapshot = await db
      .collection('deletion_jobs')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    if (snapshot.empty) {
      return null;
    }
    return snapshot.docs[0].data();
  }

  private async runPreflightChecks(
    userId: string,
    body: DeleteAccountRequestBody,
    context: DeleteAccountContext
  ): Promise<PreflightResult> {
    const [userDoc, subscDoc, premiumDoc, registryDoc] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('subsc').doc(userId).get(),
      db.collection('premiumusers').doc(userId).get(),
      db.collection('deleted_users_subsc').doc(userId).get(),
    ]);

    const registry = registryDoc.exists ? (registryDoc.data() as DeletedUserRegistryRecord) : undefined;
    if (registry?.legalHold || userDoc.data()?.legalHold) {
      throw new DeleteAccountError('LEGAL_HOLD_ACTIVE', 'Hesap hukuki sebeplerle silinemez', 423);
    }

    const userData = userDoc.data() || {};
    const subscData = subscDoc.data() || {};

    const rawEmail = subscData.email || userData.email || null;
    const resolvedEmail = typeof rawEmail === 'string' ? rawEmail.toLowerCase() : null;

    return {
      email: resolvedEmail || rawEmail,
      provider: subscData.provider || userData.provider,
      appUserId: resolvedEmail || userId,
      userProfile: userData,
      isAlreadyDeleted: Boolean(userData.isDeleted),
      deletedRegistry: registry,
    };
  }

  private async fetchSubscriptionStatus(appUserId: string): Promise<RevenueCatCheckResult | null> {
    try {
      if (!appUserId) {
        return null;
      }
      return await revenueCatService.checkActiveSubscription(appUserId);
    } catch (error) {
      throw new DeleteAccountError(
        'REVENUECAT_UNAVAILABLE',
        'Abonelik durumu doğrulanamadı',
        502,
        error
      );
    }
  }

  private async performSoftDelete(params: {
    userId: string;
    email?: string;
    provider?: string;
    deleteReason: DeleteReason | 'user_request';
    context: DeleteAccountContext;
    restoreUntil?: string;
    jobId: string;
    isAnonymous: boolean;
    hasActiveSubscription: boolean;
    appUserId?: string;
    platform?: string;
    userProfile?: Record<string, any>;
    deleteRequestPayload?: DeleteAccountRequestBody;
  }) {
    const {
      userId,
      email,
      provider,
      deleteReason,
      context,
      restoreUntil,
      jobId,
      isAnonymous,
      hasActiveSubscription,
      appUserId,
      platform,
      userProfile,
      deleteRequestPayload,
    } = params;
    const batch = db.batch();

    batch.set(
      db.collection('subsc').doc(userId),
      {
        is_deleted: true,
        isDeleted: true,
        deletedAt: FieldValue.serverTimestamp(),
        premiumCancelledAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await batch.commit();

    const deleteDate = new Date().toISOString();
    const subscriptionSource = provider?.includes('google')
      ? 'google_play'
      : provider?.includes('apple')
      ? 'apple'
      : platform || deleteRequestPayload?.platform || 'unknown';
    const googlePlayPurchaseToken =
      (deleteRequestPayload as any)?.googlePlayPurchaseToken ||
      userProfile?.googlePlayPurchaseToken ||
      userProfile?.lastPurchaseToken ||
      null;

    const registry: DeletedUserRegistryRecord = {
      uid: userId,
      email,
      provider,
      deletedAt: deleteDate,
      deleteReason,
      canRestoreUntil: restoreUntil ?? null,
      restoreExpiresAt: restoreUntil ?? null,
      restoreWindow: config.deleteAccount.restoreWindowDays,
      ip: context.ipAddress,
      userAgent: context.userAgent,
      legalHold: false,
      fraudSuspected: false,
      anonymous: isAnonymous,
      jobId,
      activeSubscriptionDetected: hasActiveSubscription,
      oldUid: userId,
      oldAppUserId: appUserId || userId,
      deleteDate,
      subscriptionSource,
      googlePlayPurchaseToken,
    };

    await db.collection('deleted_users_subsc').doc(userId).set(registry, { merge: true });

    await db
      .collection('notification_blacklist')
      .doc(userId)
      .set({
        userId,
        blockedAt: FieldValue.serverTimestamp(),
        reason: 'account_deleted',
      });
  }

  private async revokeSessionsAndTokens(userId: string) {
    await SessionService.revokeAllUserSessions(userId);
    const adminAuth = admin.auth() as any;
    if (adminAuth && typeof adminAuth.revokeRefreshTokens === 'function') {
      await adminAuth.revokeRefreshTokens(userId).catch((error: unknown) => {
        logger.warn({ err: error, userId }, 'Failed to revoke Firebase refresh tokens');
      });
    }
    await cacheService.invalidateAuthCache(userId);
    await cacheService.invalidateUserCache(userId);
  }

  private async deleteFirebaseAuthAccount(userId: string, options: { hasActiveSubscription: boolean }) {
    if (options.hasActiveSubscription) {
      logger.info({ userId }, 'Skipping Firebase Auth deletion due to active subscription');
      return;
    }

    try {
      await admin.auth().deleteUser(userId);
      logger.info({ userId }, 'Firebase Auth user deleted');
    } catch (error: any) {
      if (error?.code === 'auth/user-not-found') {
        logger.warn({ userId }, 'Firebase Auth user already deleted');
        return;
      }
      logger.error({ err: error, userId }, 'Failed to delete Firebase Auth user');
      throw new DeleteAccountError('AUTH_DELETE_FAILED', 'Firebase Auth hesabı silinemedi', 502, error);
    }
  }

  private async cleanupFirestoreData(userId: string): Promise<number> {
    let deleted = 0;
    const tasks = [
      this.deleteByField('chats', 'ownerId', userId),
      this.deleteByField('sessions', 'userId', userId),
      this.deleteByField('recentTasks', 'userId', userId),
      this.deleteByField('deviceTokens', 'userId', userId),
      this.deleteByField('pushTokens', 'userId', userId),
      this.deleteDocumentIfExists('deviceTokens', userId),
      this.deleteDocumentIfExists('pushTokens', userId),
      this.recursiveDeletePath(`users/${userId}`),
      this.recursiveDeletePath(`messages/${userId}`),
      this.recursiveDeletePath(`uploads/${userId}`),
    ];

    const results = await Promise.all(tasks);
    deleted = results.reduce((sum, count) => sum + count, 0);
    return deleted;
  }

  private async cleanupStorageData(userId: string): Promise<number> {
    const prefixes = [`uploads/${userId}`, `history/${userId}`, `profileImages/${userId}`, `tempFiles/${userId}`];
    const bucket = storage.bucket();
    let deleted = 0;

    for (const prefix of prefixes) {
      try {
        const [files] = await bucket.getFiles({ prefix });
        if (!files || files.length === 0) {
          continue;
        }
        await Promise.all(
          files.map(async file => {
            try {
              await file.delete();
              deleted += 1;
            } catch (error) {
              logger.warn({ err: error, prefix, file: file.name }, 'Failed to delete storage object');
            }
          })
        );
      } catch (error) {
        logger.warn({ err: error, prefix }, 'Failed to enumerate storage prefix');
      }
    }

    return deleted;
  }

  private async cleanupThirdParties(payload: { userId: string; email?: string; reason: string }) {
    await Promise.allSettled([
      thirdPartyIntegrationService.anonymizeInCrm({
        userId: payload.userId,
        email: payload.email,
        reason: payload.reason,
        deletedAt: new Date().toISOString(),
      }),
      thirdPartyIntegrationService.purgeAnalyticsProfile({
        userId: payload.userId,
        email: payload.email,
        reason: payload.reason,
        deletedAt: new Date().toISOString(),
      }),
      thirdPartyIntegrationService.notifySupportDesk({
        userId: payload.userId,
        email: payload.email,
        reason: payload.reason,
        deletedAt: new Date().toISOString(),
      }),
    ]);
  }

  private async recordTelemetryEvent(data: {
    userId: string;
    jobId: string;
    deleteReason: string;
    restoreUntil?: string;
    durationMs: number;
    context: DeleteAccountContext;
    anonymous: boolean;
  }) {
    if (!config.deleteAccount.telemetryEnabled) {
      return;
    }

    await db.collection('telemetry_events').add({
      event: 'DELETE_ACCOUNT',
      userId: data.userId,
      jobId: data.jobId,
      reason: data.deleteReason,
      restoreUntil: data.restoreUntil || null,
      durationMs: data.durationMs,
      context: data.context,
      anonymous: data.anonymous,
      status: 'completed',
      timestamp: FieldValue.serverTimestamp(),
    });
  }

  private async deleteByField(collection: string, field: string, value: string): Promise<number> {
    try {
      const snapshot = await db
        .collection(collection)
        .where(field, '==', value)
        .limit(500)
        .get();
      if (snapshot.empty) {
        return 0;
      }
      const batch = db.batch();
      snapshot.docs.forEach(
        (
          doc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>
        ) => batch.delete(doc.ref)
      );
      await batch.commit();
      return snapshot.size;
    } catch (error) {
      logger.warn({ err: error, collection, field }, 'Failed to delete documents by field');
      return 0;
    }
  }

  private async deleteDocumentIfExists(collection: string, docId: string): Promise<number> {
    try {
      const ref = db.collection(collection).doc(docId);
      const doc = await ref.get();
      if (doc.exists) {
        await ref.delete();
        return 1;
      }
      return 0;
    } catch (error) {
      logger.warn({ err: error, collection, docId }, 'Failed to delete document');
      return 0;
    }
  }

  private async recursiveDeletePath(pathLike: string): Promise<number> {
    try {
      const segments = pathLike.split('/').filter(Boolean);
      if (segments.length < 2) {
        return 0;
      }

      const [rootCollection, docId, ...rest] = segments;
      let target: any = db.collection(rootCollection).doc(docId);
      while (rest.length > 0) {
        const segment = rest.shift();
        if (!segment) break;
        target = target.collection(segment);
        const next = rest.shift();
        if (!next) break;
        target = target.doc(next);
      }

      const firestoreAdmin: any = admin.firestore();
      if (typeof firestoreAdmin.recursiveDelete === 'function') {
        await firestoreAdmin.recursiveDelete(target);
      } else {
        await target.delete?.();
      }
      return 1;
    } catch (error) {
      logger.debug({ path: pathLike, err: error }, 'Recursive delete skipped');
      return 0;
    }
  }

  private buildNotificationUser(userId: string, preflight: PreflightResult): DeleteNotificationUser {
    const profile = preflight.userProfile || {};
    return {
      id: userId,
      email: preflight.email || profile.email,
      name:
        profile.displayName ||
        profile.name ||
        profile.fullName ||
        profile.username ||
        profile.email,
      language: profile.language || profile.locale,
      pushToken: profile.pushToken,
      fcmToken: profile.fcmToken,
      expoPushToken: profile.expoPushToken,
      notificationToken: profile.notificationToken,
    };
  }

  private createPhaseTracker(): DeletionJobPhase[] {
    return DELETION_PHASES.map(name => ({
      name,
      status: 'pending',
    }));
  }

  private updatePhase(
    phases: DeletionJobPhase[],
    name: PhaseName,
    status: DeletionJobPhase['status'],
    error?: string
  ) {
    const phase = phases.find(item => item.name === name);
    if (!phase) {
      return;
    }
    phase.status = status;
    const now = new Date().toISOString();
    if (status === 'running') {
      phase.startedAt = now;
    } else {
      phase.completedAt = now;
    }
    if (error) {
      phase.error = error;
    }
  }

  private calculateRestoreUntil(isAnonymous: boolean): string | undefined {
    if (isAnonymous) {
      return undefined;
    }
    const days = config.deleteAccount.restoreWindowDays;
    if (!days || days <= 0) {
      return undefined;
    }
    const window = new Date();
    window.setDate(window.getDate() + days);
    return window.toISOString();
  }

  private ensureLogDirectory() {
    try {
      if (!fs.existsSync(this.logDirectory)) {
        fs.mkdirSync(this.logDirectory, { recursive: true });
      }
    } catch (error) {
      logger.warn({ err: error }, 'Failed to ensure delete account log directory');
    }
  }

  private async appendDeletionLog(line: string) {
    try {
      const filePath = path.join(
        this.logDirectory,
        `delete-account-${new Date().toISOString().split('T')[0]}.log`
      );
      await fs.promises.appendFile(filePath, `${line}\n`);
    } catch (error) {
      logger.warn({ err: error }, 'Failed to append delete account log');
    }
  }

  private normalizeError(error: unknown): DeleteAccountError {
    if (error instanceof DeleteAccountError) {
      return error;
    }
    const err = error as Error;
    return new DeleteAccountError('DELETE_FAILED', err?.message || 'Delete account failed', 500, error);
  }

  private sanitizeDetails(details: unknown): unknown {
    if (details === null || details === undefined) {
      return null;
    }
    if (typeof details === 'string' || typeof details === 'number' || typeof details === 'boolean') {
      return details;
    }
    if (details instanceof Error) {
      return { message: details.message, stack: details.stack };
    }
    if (Array.isArray(details)) {
      return details
        .map((entry) => this.sanitizeDetails(entry))
        .filter((entry) => entry !== undefined);
    }
    if (typeof details === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
        if (value !== undefined && typeof value !== 'function') {
          sanitized[key] = this.sanitizeDetails(value);
        }
      }
      return sanitized;
    }
    return String(details);
  }

  private extractProviders(authRecord: any): string[] {
    if (!authRecord || !authRecord.providerData) {
      return [];
    }
    return authRecord.providerData.map((provider: any) => provider.providerId).filter(Boolean);
  }

  private async safeGetAuthUser(userId: string): Promise<any> {
    try {
      return await admin.auth().getUser(userId);
    } catch (error) {
      logger.warn({ err: error, userId }, 'Failed to fetch Firebase auth user');
      return null;
    }
  }
  private scheduleCompletionNotification(user: DeleteNotificationUser) {
    const delayMs = config.deleteAccount.completionEmailDelayMs || 300000;
    logger.info({ userId: user.id, delayMs }, 'Scheduling delete account completion notification');
    const timer = setTimeout(async () => {
      try {
        await notificationService.sendDeleteAccountCompleted(user);
        logger.info({ userId: user.id }, 'Delayed delete account completion notification sent');
      } catch (error) {
        logger.error({ err: error, userId: user.id }, 'Failed to send delayed delete account completion notification');
      }
    }, delayMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }
}

export const deleteAccountService = new DeleteAccountService();


