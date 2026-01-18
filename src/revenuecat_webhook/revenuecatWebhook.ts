import { Router, Request, Response } from 'express';
import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { logger } from '../utils/logger';
import { attachRouteLogger } from '../utils/routeLogger';

if (!admin.apps.length) {
  admin.initializeApp();
}

const WEBHOOK_SECRET = (process.env.REVENUECAT_WEBHOOK_SECRET || '').trim();

type PremiumStatus = 'monthly' | 'annual' | 'lifetime' | 'unknown' | null;
type PremiumStore = 'google_play' | 'app_store' | 'stripe' | 'unknown';
type PremiumEnvironment = 'production' | 'sandbox' | 'unknown';

interface PremiumUserDoc {
  uid: string;
  premium: boolean;
  premiumStatus: PremiumStatus;
  premiumExpiresAt: string | null;
  premiumStartedAt: string | null;
  premiumLastRenewedAt: string | null;
  premiumEndedAt: string | null;
  isCancelled: boolean;
  willCancelAtPeriodEnd: boolean;
  cancellationEffectiveDate: string | null;
  billingIssue: boolean;
  billingIssueDetectedAt: string | null;
  billingRecoveredAt: string | null;
  store: PremiumStore;
  productId: string | null;
  entitlementId: string | null;
  transactionId: string | null;
  originalTransactionId: string | null;
  transactionIdHash: string | null;
  receiptHash: string | null;
  environment: PremiumEnvironment;
  lastPremiumEventType: string | null;
  lastPremiumDecisionId: string | null;
  lastPremiumDecisionOrigin: 'revenuecat_webhook';
  lastPremiumWebhookAt: string | null;
  lastPremiumDecisionSource?: string | null;
  lastPremiumDecisionPlatform?: string | null;
  lastPremiumDecisionRequestId?: string | null;
  lastPremiumDecisionTriggeredBy?: string | null;
  lastPremiumVerifiedAt?: string | null;
  updatedAt: string;
  createdAt?: string;
  lastRawEvent?: any;
  originalAppUserId?: string | null;
  storeCountry?: string | null;
  deviceId?: string | null;
  ipAddress?: string | null;
  alias?: string | null;
  billingIssueReason?: string | null;
  premiumSource?: string | null;
  lastSyncedSource?: string | null;
  lastSyncedOrigin?: string | null;
  lastSyncedPlatform?: string | null;
}

interface PremiumLogEntry {
  logId: string;
  userId: string;
  eventType: string;
  premiumBefore: boolean;
  premiumAfter: boolean;
  timestamp: string;
  environment: PremiumEnvironment;
  store: PremiumStore;
  productId: string | null;
  decisionId: string | null;
  requestId: string | null;
  rawEvent: any;
}

const PREMIUM_USER_COLLECTION = 'premiumusers';
const PREMIUM_LOGS_COLLECTION = 'premiumusers_logs';

const hashValue = (value?: string | object | null): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(normalized).digest('hex');
};

const determinePremiumStatus = (productIdentifier?: string | null): PremiumStatus => {
  const normalized = productIdentifier?.toLowerCase() ?? '';
  if (!normalized) {
    return null;
  }
  if (normalized.includes('lifetime')) {
    return 'lifetime';
  }
  if (
    normalized.includes('yearly') ||
    normalized.includes('annual') ||
    normalized.includes('year') ||
    normalized.includes('12')
  ) {
    return 'annual';
  }
  if (normalized.includes('monthly') || normalized.includes('month') || normalized.includes('30')) {
    return 'monthly';
  }
  return 'unknown';
};

const determineStore = (subscriber: any, productId?: string | null): PremiumStore => {
  const attributeStore = subscriber?.attributes?.store?.value?.toLowerCase?.();
  const subscriptionStore =
    productId && subscriber?.subscriptions?.[productId]?.store?.toLowerCase?.();
  const store = attributeStore || subscriptionStore || '';

  if (store.includes('google') || store.includes('play')) {
    return 'google_play';
  }
  if (store.includes('apple') || store.includes('app_store') || store.includes('appstore')) {
    return 'app_store';
  }
  if (store.includes('stripe')) {
    return 'stripe';
  }
  return 'unknown';
};

const normalizeEnvironment = (value?: string | null): PremiumEnvironment => {
  const normalized = (value || '').toLowerCase();
  if (normalized === 'production' || normalized === 'prod' || normalized === 'live') {
    return 'production';
  }
  if (normalized === 'sandbox' || normalized === 'test') {
    return 'sandbox';
  }
  return 'unknown';
};

const getExpiresDate = (entitlement: any, webhookEvent: any): string | null => {
  if (entitlement?.expires_date) {
    return entitlement.expires_date;
  }
  if (webhookEvent?.expiration_at_ms) {
    return new Date(Number(webhookEvent.expiration_at_ms)).toISOString();
  }
  if (webhookEvent?.expires_date) {
    return webhookEvent.expires_date;
  }
  return null;
};

const deriveTransactionMeta = (subscriber: any, webhookEvent: any, productId?: string | null) => {
  const subscription = productId ? subscriber?.subscriptions?.[productId] : null;
  const entTransaction = webhookEvent?.transaction_id || webhookEvent?.transactionId;
  const originalTransaction =
    webhookEvent?.original_transaction_id ||
    subscription?.original_purchase_transaction_id ||
    subscriber?.first_seen_transaction_id ||
    null;

  return {
    transactionId: entTransaction || subscription?.transaction_id || null,
    originalTransactionId: originalTransaction || null,
  };
};

const applyEventMutations = (
  eventType: string,
  updates: PremiumUserDoc,
  context: {
    nowISO: string;
    expiresAt: string | null;
    derivedStatus: PremiumStatus;
    entitlement: any;
  },
  previousState?: PremiumUserDoc | null
) => {
  switch (eventType) {
    case 'INITIAL_PURCHASE':
      updates.premium = true;
      updates.premiumStartedAt = updates.premiumStartedAt ?? context.nowISO;
      updates.premiumExpiresAt = context.expiresAt;
      updates.premiumStatus = context.derivedStatus ?? updates.premiumStatus ?? 'unknown';
      updates.isCancelled = false;
      updates.willCancelAtPeriodEnd = false;
      updates.billingIssue = false;
      updates.billingIssueDetectedAt = null;
      updates.billingRecoveredAt = null;
      break;

    case 'RENEWAL':
      updates.premium = true;
      updates.premiumLastRenewedAt = context.nowISO;
      updates.premiumExpiresAt = context.expiresAt;
      updates.billingIssue = false;
      updates.billingIssueDetectedAt = null;
      updates.billingRecoveredAt = null;
      break;

    case 'EXPIRATION':
      updates.premium = false;
      updates.premiumExpiresAt = null;
      updates.premiumEndedAt = context.nowISO;
      updates.isCancelled = true;
      updates.willCancelAtPeriodEnd = false;
      updates.cancellationEffectiveDate =
        previousState?.premiumExpiresAt ?? context.expiresAt ?? updates.cancellationEffectiveDate ?? null;
      updates.billingIssue = false;
      updates.billingIssueDetectedAt = null;
      break;

    case 'GRACE_PERIOD_EXPIRED':
      updates.premium = false;
      updates.premiumEndedAt = context.nowISO;
      updates.premiumExpiresAt = null;
      updates.billingIssue = true;
      updates.billingIssueReason = 'GRACE_PERIOD_EXPIRED';
      break;

    case 'BILLING_ISSUE':
      updates.billingIssue = true;
      updates.billingIssueDetectedAt = context.nowISO;
      updates.billingIssueReason = 'BILLING_ISSUE';
      break;

    case 'BILLING_RECOVERY':
      updates.billingIssue = false;
      updates.billingRecoveredAt = context.nowISO;
      updates.billingIssueReason = null;
      break;

    case 'CANCELLATION':
      updates.isCancelled = true;
      updates.willCancelAtPeriodEnd = true;
      updates.cancellationEffectiveDate = context.expiresAt;
      break;

    case 'UNCANCELLATION':
      updates.isCancelled = false;
      updates.willCancelAtPeriodEnd = false;
      updates.cancellationEffectiveDate = null;
      break;

    case 'PRODUCT_CHANGE':
      updates.premium = true;
      updates.premiumStatus = context.derivedStatus ?? updates.premiumStatus ?? 'unknown';
      updates.premiumExpiresAt = context.expiresAt;
      updates.productId = context.entitlement?.product_identifier ?? updates.productId ?? null;
      break;

    case 'ENTITLEMENT_GRANT':
    case 'IN_APP_PURCHASE':
    case 'NON_RENEWING_PURCHASE':
    case 'PROMOTIONAL_OFFER_REDEEMED':
      updates.premium = true;
      updates.premiumStatus = context.derivedStatus ?? updates.premiumStatus ?? 'unknown';
      updates.premiumExpiresAt = context.expiresAt;
      updates.premiumStartedAt = updates.premiumStartedAt ?? context.nowISO;
      break;

    case 'TRANSFER':
      if (context.entitlement?.is_active) {
        updates.premium = true;
        updates.premiumExpiresAt = context.expiresAt;
        updates.premiumEndedAt = null;
      } else {
        updates.premium = false;
        updates.premiumExpiresAt = null;
        updates.premiumEndedAt = context.nowISO;
      }
      break;

    case 'ENTITLEMENT_REVOKE':
      updates.premium = false;
      updates.premiumExpiresAt = null;
      updates.premiumEndedAt = context.nowISO;
      break;

    case 'SUBSCRIBER_ALIAS_CHANGED':
      // no premium change, but keep alias metadata
      break;

    default:
      if (context.entitlement) {
        updates.premium = context.entitlement.is_active === true;
        updates.premiumExpiresAt = context.entitlement.is_active ? context.expiresAt : null;
      }
      break;
  }
};

export const revenuecatWebhookHandler = async (req: Request, res: Response): Promise<void> => {
  if (req.method !== 'POST') {
    logger.warn({ method: req.method, path: req.originalUrl }, 'RevenueCat webhook rejected non-POST request');
    res.status(405).send('Method Not Allowed');
    return;
  }

  if (!WEBHOOK_SECRET) {
    logger.error('RevenueCat webhook authorization secret missing in environment');
    res.status(500).send('Webhook authorization not configured');
    return;
  }

  const incomingAuthHeader = (req.get('Authorization') || '').trim();
  logger.debug({ headerPresent: !!incomingAuthHeader }, 'RevenueCat webhook authorization header received');
  if (!incomingAuthHeader) {
    logger.warn('RevenueCat webhook missing Authorization header');
    res.status(401).send('Missing authorization header');
    return;
  }

  if (incomingAuthHeader !== WEBHOOK_SECRET) {
    logger.warn('RevenueCat webhook authorization header mismatch');
    res.status(401).send('Invalid authorization header');
    return;
  }

  const eventBody = (req.body || {}) as any;
  logger.debug(
    {
      payloadKeys: Object.keys(eventBody || {}),
      subscriberKeys: Object.keys(eventBody?.subscriber || {}),
      eventKeys: Object.keys(eventBody?.event || {}),
    },
    'RevenueCat webhook payload structure'
  );

  try {
    const webhookEvent = eventBody.event || {};
    const subscriber = eventBody.subscriber || webhookEvent.subscriber || {};
    const eventTypeName: string = webhookEvent?.type || 'UNKNOWN';
    const nowISO = new Date().toISOString();
    logger.info(
      {
        eventType: eventTypeName,
        eventId: webhookEvent?.id || webhookEvent?.event_id || webhookEvent?.transaction_id,
        requestId: webhookEvent?.event_id || webhookEvent?.request_id,
        store: webhookEvent?.store,
      },
      'RevenueCat webhook event received'
    );

    const firebaseUserId = subscriber?.attributes?.firebaseUserId?.value ?? null;
    const appUserEmailAttr =
      subscriber?.attributes?.appUserEmail?.value ||
      subscriber?.attributes?.email?.value ||
      null;
    const rcAppUserIdRaw =
      webhookEvent?.app_user_id ||
      subscriber?.app_user_id ||
      eventBody?.app_user_id ||
      null;
    const originalAppUserId =
      subscriber?.original_app_user_id ||
      webhookEvent?.original_app_user_id ||
      eventBody?.original_app_user_id ||
      null;

    const normalizeEmail = (value?: string | null) => {
      if (!value || typeof value !== 'string') {
        return null;
      }
      const trimmed = value.trim();
      if (!trimmed || !trimmed.includes('@')) {
        return null;
      }
      return trimmed.toLowerCase();
    };

    const isAnonymousId = (value?: string | null) =>
      typeof value === 'string' && value.startsWith('RCAnonymousID:');

    const rcAppUserEmailCandidate =
      !isAnonymousId(rcAppUserIdRaw) ? normalizeEmail(rcAppUserIdRaw) : null;
    const emailCandidate = normalizeEmail(appUserEmailAttr) || rcAppUserEmailCandidate;

    logger.debug(
      {
        firebaseUserId,
        hasEmailCandidate: !!emailCandidate,
        appUserId: rcAppUserIdRaw,
        originalAppUserId,
      },
      'RevenueCat webhook user identification payload'
    );

    let userId = firebaseUserId ?? null;

    if (!userId && emailCandidate) {
      try {
        const userRecord = await admin.auth().getUserByEmail(emailCandidate);
        userId = userRecord.uid;
      } catch (lookupError) {
        logger.warn('RevenueCat webhook failed to map email to Firebase UID', {
          emailCandidate,
          lookupError,
        });
      }
    }

    if (!userId) {
      logger.warn('RevenueCat webhook missing resolvable user id', {
        firebaseUserIdPresent: !!firebaseUserId,
        emailCandidate,
        rcAppUserId: rcAppUserIdRaw,
        originalAppUserId,
      });
      res.status(400).send('Missing user ID in payload');
      return;
    }

    let entitlement = subscriber?.entitlements?.premium ?? null;
    if (!entitlement && eventTypeName === 'TEST' && webhookEvent?.product_id) {
      entitlement = {
        product_identifier: webhookEvent.product_id,
        is_active: true,
        expires_date: webhookEvent?.expiration_at_ms
          ? new Date(Number(webhookEvent.expiration_at_ms)).toISOString()
          : null,
        environment: webhookEvent?.environment?.toLowerCase() || null,
      } as any;
    }

    const productIdentifier =
      entitlement?.product_identifier ||
      webhookEvent?.product_id ||
      subscriber?.last_seen_product_identifier ||
      null;
    const expiresAt = getExpiresDate(entitlement, webhookEvent);
    const derivedStatus = determinePremiumStatus(productIdentifier);
    const environment = normalizeEnvironment(
      webhookEvent?.environment || entitlement?.environment || subscriber?.environment
    );
    const store = determineStore(subscriber, productIdentifier);
    const { transactionId, originalTransactionId } = deriveTransactionMeta(
      subscriber,
      webhookEvent,
      productIdentifier
    );
    const eventId = webhookEvent?.id || webhookEvent?.event_id || webhookEvent?.transaction_id || null;
    const requestId = webhookEvent?.event_id || webhookEvent?.request_id || null;
    const alias = webhookEvent?.subscriber_alias || subscriber?.subscriber_alias || null;

    const premiumUsersRef = admin.firestore().collection(PREMIUM_USER_COLLECTION).doc(userId);

    let duplicateDetected = false;
    let finalUpdates: PremiumUserDoc | null = null;
    let basePremiumValue = false;

    await admin.firestore().runTransaction(async (transaction) => {
      const existingSnapshot = await transaction.get(premiumUsersRef);
      const existingData =
        (existingSnapshot.exists ? (existingSnapshot.data() as PremiumUserDoc) : null) || null;

      if (existingData?.lastPremiumDecisionId && existingData.lastPremiumDecisionId === eventId) {
        duplicateDetected = true;
        return;
      }

      basePremiumValue = existingData?.premium ?? false;

      const updates: PremiumUserDoc = {
        uid: userId,
        premium: basePremiumValue,
        premiumStatus: existingData?.premiumStatus ?? derivedStatus ?? null,
        premiumExpiresAt: existingData?.premiumExpiresAt ?? null,
        premiumStartedAt: existingData?.premiumStartedAt ?? null,
        premiumLastRenewedAt: existingData?.premiumLastRenewedAt ?? null,
        premiumEndedAt: existingData?.premiumEndedAt ?? null,
        isCancelled: existingData?.isCancelled ?? false,
        willCancelAtPeriodEnd: existingData?.willCancelAtPeriodEnd ?? false,
        cancellationEffectiveDate: existingData?.cancellationEffectiveDate ?? null,
        billingIssue: existingData?.billingIssue ?? false,
        billingIssueDetectedAt: existingData?.billingIssueDetectedAt ?? null,
        billingRecoveredAt: existingData?.billingRecoveredAt ?? null,
        store,
        productId: productIdentifier ?? existingData?.productId ?? null,
        entitlementId: entitlement ? 'premium' : existingData?.entitlementId ?? null,
        transactionId: transactionId ?? existingData?.transactionId ?? null,
        originalTransactionId: originalTransactionId ?? existingData?.originalTransactionId ?? null,
        transactionIdHash: hashValue(transactionId) ?? existingData?.transactionIdHash ?? null,
        receiptHash: hashValue(webhookEvent?.receipt) ?? existingData?.receiptHash ?? null,
        environment,
        lastPremiumEventType: eventTypeName,
        lastPremiumDecisionId: eventId,
        lastPremiumDecisionOrigin: 'revenuecat_webhook',
        lastPremiumWebhookAt: nowISO,
        lastPremiumDecisionSource: 'revenuecat_webhook',
        lastPremiumDecisionPlatform:
          subscriber?.attributes?.platform?.value ?? existingData?.lastPremiumDecisionPlatform ?? null,
        lastPremiumDecisionRequestId: requestId,
        lastPremiumDecisionTriggeredBy: 'revenuecat',
        lastPremiumVerifiedAt: nowISO,
        updatedAt: nowISO,
        lastRawEvent: webhookEvent,
        originalAppUserId: originalAppUserId || existingData?.originalAppUserId || null,
        storeCountry:
          subscriber?.attributes?.storeCountry?.value ||
          webhookEvent?.store_country ||
          existingData?.storeCountry ||
          null,
        deviceId: subscriber?.attributes?.deviceId?.value || existingData?.deviceId || null,
        ipAddress: webhookEvent?.ip_address || existingData?.ipAddress || null,
        alias: alias || existingData?.alias || null,
        billingIssueReason: existingData?.billingIssueReason ?? null,
        premiumSource: 'revenuecat',
        lastSyncedSource: 'revenuecat_webhook',
        lastSyncedOrigin: 'webhook',
        lastSyncedPlatform:
          subscriber?.attributes?.platform?.value ?? existingData?.lastSyncedPlatform ?? null,
        createdAt: existingData?.createdAt ?? nowISO,
      };

      applyEventMutations(
        eventTypeName,
        updates,
        {
          nowISO,
          expiresAt,
          derivedStatus,
          entitlement,
        },
        existingData
      );

      if (!updates.premiumStatus && derivedStatus) {
        updates.premiumStatus = derivedStatus;
      }
      if (updates.premium && !updates.premiumExpiresAt && expiresAt) {
        updates.premiumExpiresAt = expiresAt;
      }

      transaction.set(premiumUsersRef, updates, { merge: true });
      finalUpdates = updates;
    });

    if (duplicateDetected) {
      logger.info('RevenueCat webhook ignored duplicate event (transaction safe)', {
        userId,
        eventId,
        eventTypeName,
      });
      res.status(200).send('Duplicate ignored');
      return;
    }

    if (!finalUpdates) {
      throw new Error('RevenueCat webhook transaction failed to produce updates');
    }

    const resolvedUpdates = finalUpdates as PremiumUserDoc;
    const premiumAfter = resolvedUpdates.premium;
    const logEntry: PremiumLogEntry = {
      logId: `${userId}_${Date.now()}_${eventId ?? 'noevent'}`,
      userId,
      eventType: eventTypeName,
      premiumBefore: basePremiumValue,
      premiumAfter,
      timestamp: nowISO,
      environment,
      store,
      productId: resolvedUpdates.productId ?? null,
      decisionId: eventId,
      requestId,
      rawEvent: webhookEvent,
    };

    logger.info({ logId: logEntry.logId }, 'RevenueCat webhook writing log entry');
    await admin.firestore().collection(PREMIUM_LOGS_COLLECTION).doc(logEntry.logId).set(logEntry);
    logger.info('RevenueCat webhook log entry persisted to Firestore', logEntry);

    logger.info('RevenueCat webhook processed successfully', {
      userId,
      event: eventTypeName,
      premiumBefore: basePremiumValue,
      premiumAfter,
      premiumStatus: resolvedUpdates.premiumStatus,
      store,
      environment,
    });

    res.status(200).send('Success');
  } catch (error) {
    logger.error('Webhook processing error', { error });
    res.status(500).send('Internal Server Error');
  }
};

export const revenuecatWebhookRouter = Router();
attachRouteLogger(revenuecatWebhookRouter, 'revenuecatWebhook');
revenuecatWebhookRouter.post('/', revenuecatWebhookHandler);

export default revenuecatWebhookRouter;