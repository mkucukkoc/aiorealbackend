import { createHash } from 'crypto';
import { db } from '../firebase';
import { logger } from '../utils/logger';
import { revenueCatService } from './revenueCatService';
import { DeletedUserRegistryRecord } from '../types/deleteAccount';

const PREMIUM_COLLECTION = 'premiumusers';
const CLIENT_SNAPSHOT_COLLECTION = 'premium_client_snapshots';
const PREMIUM_DECISION_LOG_COLLECTION = 'premium_decision_logs';
const USERS_COLLECTION = 'users';
const SUBSC_COLLECTION = 'subsc';
const REVENUECAT_ENTITLEMENT_ID = process.env.REVENUECAT_ENTITLEMENT_ID || 'premium';

type PremiumStatus = 'monthly' | 'annual' | null;

interface PremiumState {
  premium: boolean;
  premiumStatus: PremiumStatus;
  premiumExpiresAt: string | null;
  entitlementProductId?: string | null;
  environment?: string | null;
  isSandboxOnly?: boolean;
  entitlementIds: string[];
  raw?: any;
}

interface PremiumSyncContext {
  source: string;
  origin: string;
  platform?: string;
  requestId?: string;
  triggeredBy?: string;
  decisionId?: string;
  isWebhookEvent?: boolean;
}

interface RevenueCatSubscriberPayload {
  subscriber?: {
    entitlements?: Record<string, any>;
    subscriptions?: Record<string, any>;
  };
}

type DeletedSubscriptionRecord = DeletedUserRegistryRecord & { docId: string };

export class PremiumServiceError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class PremiumService {
  async syncFromCustomerInfo(
    userId: string,
    payload: { customerInfo: any; platform?: string; source?: string; requestId?: string }
  ) {
    if (!payload?.customerInfo) {
      throw new PremiumServiceError('INVALID_PAYLOAD', 'customerInfo payload is required');
    }

    const derivedState = this.extractFromCustomerInfo(payload.customerInfo);

    await this.recordClientSnapshot(userId, payload, derivedState);

    if (!derivedState) {
      logger.info(
        { userId, source: payload.source || 'client_customer_info' },
        'Premium client snapshot kaydedildi: aktif entitlement bulunamadı'
      );
    } else {
      logger.info(
        {
          userId,
          premium: derivedState.premium,
          premiumStatus: derivedState.premiumStatus,
          expiresAt: derivedState.premiumExpiresAt,
        },
        'Premium client snapshot kaydedildi (okuma amaçlı)'
      );
    }

    const authoritativeState = await this.getStatus(userId);
    return (
      authoritativeState || {
        premium: false,
        premiumStatus: null,
        premiumExpiresAt: null,
        entitlementIds: derivedState?.entitlementIds || [],
        raw: null,
      }
    );
  }

  async restoreFromRevenueCat(
    userId: string,
    options: { appUserId?: string; requestId?: string; source?: string } = {}
  ) {
    const resolvedAppUserId = options.appUserId || (await this.resolveAppUserId(userId));
    const appUserId = resolvedAppUserId?.toLowerCase?.() ?? resolvedAppUserId;

    if (!appUserId) {
      throw new PremiumServiceError('APP_USER_ID_MISSING', 'RevenueCat uygulama kimliği belirlenemedi', 400);
    }

    logger.info({ userId, appUserId }, 'Premium restore using email identity');

    let subscriberPayload: RevenueCatSubscriberPayload;
    try {
      subscriberPayload = (await revenueCatService.fetchSubscriber(appUserId)) as RevenueCatSubscriberPayload;
    } catch (error: any) {
      if (error?.response?.status === 404 || error?.message?.includes('not found') || error?.message?.includes('404')) {
        logger.warn({ userId, appUserId, error: error.message }, 'RevenueCat subscriber not found - user may need to login via SDK first');
        throw new PremiumServiceError(
          'SUBSCRIBER_NOT_FOUND',
          'RevenueCat\'te bu e-posta ile kullanıcı bulunamadı. Lütfen önce uygulamada giriş yapın.',
          404
        );
      }
      throw error;
    }

    const hasSubscriber = !!subscriberPayload?.subscriber;
    const entitlementsContainer = subscriberPayload?.subscriber?.entitlements || {};
    const entitlementKeys = Object.keys(entitlementsContainer);
    const subscriptions = subscriberPayload?.subscriber?.subscriptions || {};
    const subscriptionKeys = Object.keys(subscriptions);

    logger.debug(
      { 
        userId, 
        appUserId, 
        hasSubscriber,
        hasEntitlements: entitlementKeys.length > 0,
        entitlementKeys,
        subscriptionKeys,
        lookingFor: REVENUECAT_ENTITLEMENT_ID
      }, 
      'RevenueCat subscriber payload received'
    );

    const premiumState = this.extractFromSubscriber(subscriberPayload);

    if (!premiumState) {
      logger.info(
        {
          userId,
          appUserId,
          entitlementPayload: entitlementsContainer,
          subscriptionPayload: subscriptions,
        },
        'RevenueCat entitlements snapshot'
      );
      logger.info(
        { 
          userId, 
          appUserId, 
          hasSubscriber,
          hasEntitlements: entitlementKeys.length > 0,
          entitlementKeys,
          subscriptionKeys,
          lookingFor: REVENUECAT_ENTITLEMENT_ID,
          rawPayload: JSON.stringify(subscriberPayload).substring(0, 500) // İlk 500 karakter
        }, 
        'Premium restore skipped: aktif abonelik bulunamadı'
      );
      throw new PremiumServiceError('ENTITLEMENT_NOT_FOUND', 'Aktif premium abonelik bulunamadı', 404);
    }

    const result = await this.writePremiumRecord(userId, premiumState, {
      source: options.source || 'restore_endpoint',
      origin: 'revenuecat',
      requestId: options.requestId,
    });

    return result;
  }

  async restoreTransferredSubscription(params: {
    currentUid: string;
    email: string;
    oldAppUserId?: string;
    requestId?: string;
    platform?: string;
  }): Promise<any> {
    const { currentUid, email, oldAppUserId, requestId, platform } = params;
    logger.info({ currentUid, email, oldAppUserId, platform }, 'Premium restore transfer requested');

    const deletedRecord = await this.findDeletedSubscriptionRecord(email, oldAppUserId);
    if (!deletedRecord) {
      if (!email) {
        throw new PremiumServiceError('RESTORE_SOURCE_NOT_FOUND', 'Geçmiş premium kaydı bulunamadı', 404);
      }
      logger.info({ currentUid, email }, 'No deleted subscription record found, falling back to email restore');
      return this.restoreFromRevenueCat(currentUid, {
        appUserId: email.toLowerCase(),
        requestId,
        source: 'restore_fallback',
      });
    }

    await db
      .collection('deleted_users_subsc')
      .doc(deletedRecord.docId)
      .set(
        {
          restoreAttemptedAt: new Date().toISOString(),
          lastRestoreRequestId: requestId || null,
        },
        { merge: true }
      )
      .catch((error: unknown) =>
        logger.warn({ err: error, docId: deletedRecord.docId }, 'Failed to log restore attempt')
      );

    const targetEmail = (deletedRecord.email || email || '').toLowerCase();
    if (!targetEmail) {
      throw new PremiumServiceError('RESTORE_SOURCE_INVALID', 'Geçerli bir e-posta bulunamadı', 400);
    }

    return this.restoreFromRevenueCat(currentUid, {
      appUserId: targetEmail,
      requestId,
      source: 'restore_transfer',
    });
  }

  async syncFromRevenueCat(
    userId: string,
    options: { appUserId?: string; requestId?: string; source?: string } = {}
  ) {
    return this.restoreFromRevenueCat(userId, { ...options, source: options.source || 'manual_sync' });
  }

  async getStatus(userId: string) {
    const doc = await db.collection(PREMIUM_COLLECTION).doc(userId).get();
    if (!doc.exists) {
      return null;
    }
    return doc.data();
  }

  private async findDeletedSubscriptionRecord(
    email: string,
    providedAppUserId?: string
  ): Promise<DeletedSubscriptionRecord | null> {
    try {
      const snapshot = await db
        .collection('deleted_users_subsc')
        .where('email', '==', email)
        .limit(25)
        .get();
      if (snapshot.empty) {
        return null;
      }
      const candidates: DeletedSubscriptionRecord[] = snapshot.docs
        .map((doc: any) => ({ docId: doc.id, ...(doc.data() as DeletedUserRegistryRecord) }))
        .sort((a: DeletedSubscriptionRecord, b: DeletedSubscriptionRecord) => {
          const aDate = a.deleteDate || a.deletedAt;
          const bDate = b.deleteDate || b.deletedAt;
          return (bDate || '').localeCompare(aDate || '');
        });

      if (providedAppUserId) {
        const match = candidates.find(
          doc =>
            doc.oldAppUserId === providedAppUserId ||
            doc.uid === providedAppUserId ||
            doc.docId === providedAppUserId
        );
        if (match) {
          return match;
        }
      }

      return candidates[0];
    } catch (error) {
      logger.error({ err: error, email }, 'Failed to query deleted subscription record');
      return null;
    }
  }

  private extractFromCustomerInfo(customerInfo: any): PremiumState | null {
    const activeEntitlements = customerInfo?.entitlements?.active || {};
    const entitlement = activeEntitlements[REVENUECAT_ENTITLEMENT_ID];

    if (!entitlement) {
      return null;
    }

    const activeSubscriptions: string[] = customerInfo?.activeSubscriptions ?? [];
    const basePlanId = this.getBasePlanIdFromSubscriptions(activeSubscriptions);
    const premiumStatus = this.determinePremiumStatus(basePlanId);

    const premiumExpiresAt =
      entitlement?.expirationDate ||
      entitlement?.expirationAt ||
      entitlement?.expiresDate ||
      entitlement?.expiration_date ||
      entitlement?.expires_date ||
      entitlement?.expiresAt ||
      entitlement?.expiration_at ||
      null;

    const entitlementIds = Object.keys(activeEntitlements);

    return {
      premium: Boolean(entitlement?.isActive ?? entitlement?.is_active ?? true),
      premiumStatus,
      premiumExpiresAt,
      entitlementProductId: entitlement?.productIdentifier || entitlement?.product_identifier,
      environment: entitlement?.environment || null,
      isSandboxOnly: entitlement?.environment === 'sandbox',
      entitlementIds,
      raw: customerInfo,
    };
  }

  private extractFromSubscriber(payload: RevenueCatSubscriberPayload): PremiumState | null {
    const entitlements = payload?.subscriber?.entitlements || {};
    const entitlement = entitlements[REVENUECAT_ENTITLEMENT_ID];

    if (!entitlement) {
      return null;
    }

    const subscriptions = payload?.subscriber?.subscriptions || {};
    const basePlanId =
      this.getBasePlanIdFromSubscriptionEntries(subscriptions) ??
      this.deriveBasePlanIdFromIdentifier(
        entitlement?.store_product_id ||
          entitlement?.product_identifier ||
          entitlement?.productIdentifier ||
          entitlement?.storeProductId ||
          null
      );
    const premiumStatus = this.determinePremiumStatus(basePlanId);

    const expiresAt =
      entitlement?.expires_date ||
      entitlement?.expiration_date ||
      entitlement?.expiresDate ||
      entitlement?.expirationDate ||
      entitlement?.expirationAt ||
      entitlement?.expiresAt ||
      entitlement?.expiration_at ||
      null;
    const entitlementIds = Object.keys(entitlements);

    const graceExpiresRaw =
      entitlement?.grace_period_expires_date ||
      entitlement?.gracePeriodExpiresDate ||
      entitlement?.grace_period_expires_at ||
      entitlement?.gracePeriodExpiresAt ||
      null;
    const graceExpiresTs = graceExpiresRaw ? new Date(graceExpiresRaw).getTime() : null;
    const graceActive = graceExpiresTs ? graceExpiresTs > Date.now() : false;

    const premiumActive = this.isEntitlementActive(expiresAt) || graceActive;

    const subscriptionEnvSandbox = Object.values(subscriptions).some(
      (sub: any) => sub?.environment === 'sandbox'
    );
    const entitlementEnvSandbox = entitlement?.environment === 'sandbox';
    const isSandbox = entitlementEnvSandbox || subscriptionEnvSandbox;

    return {
      premium: premiumActive,
      premiumStatus,
      premiumExpiresAt: expiresAt,
      entitlementProductId: entitlement?.product_identifier || entitlement?.productIdentifier,
      environment: entitlement?.environment || null,
      isSandboxOnly: isSandbox,
      entitlementIds,
      raw: payload,
    };
  }

  private isEntitlementActive(expiresAt: string | null) {
    if (!expiresAt) {
      return true;
    }
    const expiration = new Date(expiresAt).getTime();
    return Number.isNaN(expiration) ? true : expiration > Date.now();
  }

  private getBasePlanIdFromSubscriptions(subscriptions: string[]): string | null {
    if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
      return null;
    }

    const prioritized = subscriptions.find((subscriptionId) => {
      const normalized = subscriptionId.toLowerCase();
      return (
        normalized.includes('monthly') ||
        normalized.includes('month') ||
        normalized.includes('annual') ||
        normalized.includes('year')
      );
    });

    const selected = prioritized ?? subscriptions[0];
    if (!selected) {
      return null;
    }

    return this.normalizeBasePlan(selected);
  }

  private getBasePlanIdFromSubscriptionEntries(subscriptions: Record<string, any>): string | null {
    const entries = Object.entries(subscriptions || {});
    if (entries.length === 0) {
      return null;
    }

    const prioritized = entries.find(([productId]) => {
      const normalized = productId.toLowerCase();
      return (
        normalized.includes('monthly') ||
        normalized.includes('month') ||
        normalized.includes('annual') ||
        normalized.includes('year')
      );
    });

    const [selectedId, selectedSubscription] = prioritized ?? entries[0];
    const identifier =
      selectedSubscription?.store_product_id ||
      selectedSubscription?.product_identifier ||
      selectedId;

    return this.normalizeBasePlan(identifier);
  }

  private determinePremiumStatus(basePlanId: string | null): PremiumStatus {
    if (!basePlanId) {
      return null;
    }
    if (basePlanId.includes('annual') || basePlanId.includes('year')) {
      return 'annual';
    }
    if (basePlanId.includes('monthly') || basePlanId.includes('month')) {
      return 'monthly';
    }
    return null;
  }

  private deriveBasePlanIdFromIdentifier(identifier: string | null | undefined): string | null {
    if (!identifier) {
      return null;
    }
    const parts = identifier.split(':');
    const last = parts[parts.length - 1];
    return last?.toLowerCase() || null;
  }

  private normalizeBasePlan(id: string | null | undefined): string | null {
    if (!id) {
      return null;
    }
    const parts = id.split(':');
    const last = parts[parts.length - 1];
    return last?.toLowerCase() || null;
  }

  private async writePremiumRecord(userId: string, state: PremiumState, context: PremiumSyncContext) {
    const now = new Date().toISOString();
    const docRef = db.collection(PREMIUM_COLLECTION).doc(userId);
    const userProfile = await this.fetchUserProfile(userId);

    const decisionMetadata = this.buildDecisionMetadata(context, now);

    const payload: Record<string, any> = {
      uid: userId,
      premium: state.premium,
      premiumStatus: state.premiumStatus,
      premiumExpiresAt: state.premiumExpiresAt,
      entitlementProductId: state.entitlementProductId ?? null,
      entitlementEnvironment: state.environment ?? null,
      isSandboxOnly: state.isSandboxOnly ?? null,
      entitlementIds: state.entitlementIds,
      lastSyncSource: context.source,
      lastSyncOrigin: context.origin,
      lastSyncPlatform: context.platform || null,
      lastSyncRequestId: context.requestId || null,
      updatedAt: now,
      ...decisionMetadata,
    };

    if (userProfile?.email) {
      payload.email = userProfile.email.toLowerCase();
    }
    if (userProfile?.name) {
      payload.name = userProfile.name;
    }

    await docRef.set(payload, { merge: true });
    await this.logPremiumDecision(userId, state, context, now);

    logger.info(
      {
        userId,
        premium: state.premium,
        premiumStatus: state.premiumStatus,
        expiresAt: state.premiumExpiresAt,
        source: context.source,
        origin: context.origin,
      },
      'Premium record updated'
    );

    return payload;
  }

  private buildSnapshotPreview(customerInfo: any) {
    if (!customerInfo) {
      return null;
    }
    const entitlementEntries = customerInfo?.entitlements?.active || {};
    const entitlementKeys = Object.keys(entitlementEntries);
    const activeSubscriptions: string[] = Array.isArray(customerInfo?.activeSubscriptions)
      ? customerInfo.activeSubscriptions.slice(0, 10)
      : [];

    return {
      entitlementKeys,
      activeSubscriptions,
      requestDate: customerInfo?.requestDate || null,
      managementURL: customerInfo?.managementURL || null,
    };
  }

  private safeSerializeCustomerInfo(customerInfo: any): string | null {
    if (!customerInfo) {
      return null;
    }
    try {
      return JSON.stringify(customerInfo);
    } catch (error) {
      logger.warn({ err: error }, 'Failed to serialize customerInfo snapshot');
      return null;
    }
  }

  private async recordClientSnapshot(
    userId: string,
    payload: { customerInfo: any; platform?: string; source?: string; requestId?: string },
    derivedState?: PremiumState | null
  ) {
    const now = new Date().toISOString();
    const serialized = this.safeSerializeCustomerInfo(payload.customerInfo);
    const checksum = serialized ? createHash('sha256').update(serialized).digest('hex') : null;
    const source = payload.source || 'client_customer_info';
    const platform = payload.platform || null;
    const requestId = payload.requestId || null;
    const snapshotId = `${userId}_${Date.now()}`;

    const snapshotDoc = {
      snapshotId,
      userId,
      capturedAt: now,
      source,
      platform,
      requestId,
      checksum,
      derivedPremium: derivedState?.premium ?? null,
      derivedPremiumStatus: derivedState?.premiumStatus ?? null,
      derivedPremiumExpiresAt: derivedState?.premiumExpiresAt ?? null,
      entitlementIds: derivedState?.entitlementIds ?? [],
      snapshotPreview: this.buildSnapshotPreview(payload.customerInfo),
      raw: serialized ? serialized.slice(0, 10000) : null,
    };

    await db.collection(CLIENT_SNAPSHOT_COLLECTION).doc(snapshotId).set(snapshotDoc, { merge: true });

    await db
      .collection(PREMIUM_COLLECTION)
      .doc(userId)
      .set(
        {
          lastClientSnapshotAt: now,
          lastClientSnapshotSource: source,
          lastClientSnapshotPlatform: platform,
          lastClientSnapshotChecksum: checksum,
          lastClientSnapshotId: snapshotId,
        },
        { merge: true }
      );
  }

  private buildDecisionMetadata(context: PremiumSyncContext, timestamp: string) {
    const metadata: Record<string, any> = {
      lastPremiumDecisionAt: timestamp,
      lastPremiumDecisionSource: context.source,
      lastPremiumDecisionOrigin: context.origin,
      lastPremiumDecisionPlatform: context.platform || null,
      lastPremiumDecisionRequestId: context.requestId || null,
      lastPremiumDecisionTriggeredBy: context.triggeredBy || null,
      lastPremiumDecisionId: context.decisionId || null,
    };

    if (context.origin === 'revenuecat' || context.source.includes('sync')) {
      metadata.lastPremiumVerifiedAt = timestamp;
    }

    if (context.isWebhookEvent || context.source === 'revenuecat_webhook') {
      metadata.lastPremiumWebhookEventAt = timestamp;
    }

    return metadata;
  }

  private async logPremiumDecision(
    userId: string,
    state: PremiumState,
    context: PremiumSyncContext,
    timestamp: string
  ) {
    const logId = `${userId}_${Date.now()}`;
    const logDoc = {
      logId,
      userId,
      premium: state.premium,
      premiumStatus: state.premiumStatus,
      premiumExpiresAt: state.premiumExpiresAt,
      entitlementIds: state.entitlementIds,
      entitlementProductId: state.entitlementProductId ?? null,
      environment: state.environment ?? null,
      isSandboxOnly: state.isSandboxOnly ?? null,
      source: context.source,
      origin: context.origin,
      platform: context.platform || null,
      requestId: context.requestId || null,
      triggeredBy: context.triggeredBy || null,
      decisionId: context.decisionId || null,
      isWebhookEvent: Boolean(context.isWebhookEvent),
      loggedAt: timestamp,
    };

    await db.collection(PREMIUM_DECISION_LOG_COLLECTION).doc(logId).set(logDoc, { merge: true });
    logger.info(
      {
        userId,
        logId,
        source: context.source,
        origin: context.origin,
        premium: state.premium,
        premiumStatus: state.premiumStatus,
      },
      'Premium decision audit logged'
    );
  }

  private async fetchUserProfile(userId: string) {
    try {
      const doc = await db.collection(USERS_COLLECTION).doc(userId).get();
      if (!doc.exists) {
        return null;
      }
      const data = doc.data() || {};
      return {
        email: data.email,
        name: data.name || data.displayName || data.fullName,
      };
    } catch (error) {
      logger.warn({ err: error, userId }, 'Failed to fetch user profile for premium sync');
      return null;
    }
  }

  private async resolveAppUserId(userId: string) {
    const profile = await this.fetchUserProfile(userId);
    if (profile?.email) {
      return profile.email.toLowerCase();
    }

    const fallbackEmail = await this.fetchSubscEmail(userId);
    if (fallbackEmail) {
      return fallbackEmail.toLowerCase();
    }

    return null;
  }

  private async fetchSubscEmail(userId: string): Promise<string | null> {
    try {
      const doc = await db.collection(SUBSC_COLLECTION).doc(userId).get();
      if (!doc.exists) {
        return null;
      }
      const data = doc.data() || {};
      if (typeof data.email === 'string' && data.email.trim().length > 0) {
        return data.email.trim();
      }
    } catch (error) {
      logger.warn({ err: error, userId }, 'Failed to fetch subsc email for premium sync');
    }
    return null;
  }
}

export const premiumService = new PremiumService();

