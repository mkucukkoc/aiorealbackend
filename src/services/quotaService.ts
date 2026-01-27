import { db } from '../firebase';
import type { Transaction, DocumentReference } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import { resolvePlanConfig, getPlanConfigById, PlanCycle } from '../config/quotaConfig';
import { createHash } from 'crypto';

const USERS_QUOTA_COLLECTION = 'users_quota';
const SUBSCRIPTIONS_COLLECTION = 'subscriptions_quota';
const WALLETS_COLLECTION = 'quota_wallets';
const USAGES_COLLECTION = 'quota_usages';
const WEBHOOK_EVENTS_COLLECTION = 'webhook_events';

export type SubscriptionStatus = 'active' | 'cancelled' | 'expired' | 'refunded' | 'billing_issue';
export type WalletStatus = 'active' | 'closed';
export type UsageStatus = 'reserved' | 'committed' | 'rolled_back';

export type QuotaUserDoc = {
  id: string;
  email?: string | null;
  status?: string | null;
  created_at: string;
  updated_at: string;
};

export type SubscriptionDoc = {
  id: string;
  user_id: string;
  platform: string | null;
  rc_app_user_id: string | null;
  product_id: string | null;
  plan_id: string | null;
  plan_key: string | null;
  cycle: PlanCycle | null;
  entitlement_ids: string[];
  is_active: boolean;
  will_renew: boolean;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  last_rc_event_at: string | null;
  original_purchase_date: string | null;
  updated_at: string;
  created_at: string;
};

export type QuotaWalletDoc = {
  id: string;
  user_id: string;
  subscription_id: string | null;
  plan_id: string | null;
  scope: PlanCycle;
  period_start: string | null;
  period_end: string | null;
  quota_total: number;
  quota_used: number;
  status: WalletStatus;
  last_usage_at: string | null;
  created_at: string;
  updated_at: string;
};

export type QuotaUsageDoc = {
  id: string;
  user_id: string;
  wallet_id: string;
  request_id: string;
  action: string;
  amount: number;
  status: UsageStatus;
  created_at: string;
  updated_at: string;
};

export type QuotaSnapshot = {
  planId: string | null;
  planKey: string | null;
  cycle: PlanCycle | null;
  isActive: boolean;
  willRenew: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  quotaTotal: number;
  quotaUsed: number;
  quotaRemaining: number;
  walletId: string | null;
};

export type ReserveResult = {
  allowed: boolean;
  status: UsageStatus | 'rejected';
  remaining: number;
  walletId: string | null;
  quota?: QuotaSnapshot | null;
};

export type RevenueCatEventContext = {
  userId: string;
  eventId: string | null;
  eventType: string;
  rcAppUserId: string | null;
  productId: string | null;
  entitlementIds: string[];
  platform: string | null;
  willRenew: boolean | null;
  periodStart: string | null;
  periodEnd: string | null;
  originalPurchaseDate: string | null;
  rawEvent: any;
};

export const resolvePlanId = (candidate: string | null | undefined): string | null => {
  const resolved = resolvePlanConfig(candidate);
  return resolved?.planId ?? null;
};

const toIso = (value: string | number | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const toHash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const normalizeEventType = (value: string | null | undefined): string =>
  (value || 'UNKNOWN').toUpperCase();

const getWebhookEventId = (payload: RevenueCatEventContext): string => {
  if (payload.eventId) return `rc_${payload.eventId}`;
  const composite = `${payload.userId}:${payload.eventType}:${payload.periodStart ?? ''}:${payload.periodEnd ?? ''}`;
  return `rc_${toHash(composite)}`;
};

const isPurchaseEvent = (eventType: string) =>
  ['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'SUBSCRIPTION_PURCHASE'].includes(
    eventType
  );

const isCancellationEvent = (eventType: string) =>
  ['CANCELLATION', 'CANCEL', 'AUTO_RENEW_DISABLED'].includes(eventType);

const isExpirationEvent = (eventType: string) => ['EXPIRATION', 'EXPIRE'].includes(eventType);

const isRefundEvent = (eventType: string) => ['REFUND', 'CHARGEBACK'].includes(eventType);

const isBillingIssueEvent = (eventType: string) =>
  ['BILLING_ISSUE', 'PAUSE', 'BILLING_ISSUE_DETECTED', 'GRACE_PERIOD'].includes(eventType);

const shouldCloseWalletStatus = (status: SubscriptionStatus) =>
  status === 'expired' || status === 'refunded' || status === 'billing_issue';

class QuotaService {
  async ensureQuotaForUser(
    userId: string,
    premiumStatus?: { premium?: boolean; entitlementProductId?: string | null }
  ): Promise<QuotaSnapshot | null> {
    await this.ensureUserRecord(userId);

    const subscription = await this.getSubscription(userId);
    if (subscription) {
      return this.buildQuotaSnapshot(subscription);
    }

    if (premiumStatus?.premium) {
      const planId = resolvePlanId(premiumStatus.entitlementProductId ?? null);
      if (planId) {
        await this.syncQuotaFromPlan(userId, planId);
      }
    }

    return this.getQuotaSnapshot(userId);
  }

  async ensureUserRecord(userId: string, email?: string | null): Promise<void> {
    const docRef = db.collection(USERS_QUOTA_COLLECTION).doc(userId);
    const now = new Date().toISOString();
    await docRef.set(
      {
        id: userId,
        email: email ?? null,
        updated_at: now,
        created_at: now,
      },
      { merge: true }
    );
  }

  async getSubscription(userId: string): Promise<SubscriptionDoc | null> {
    const docRef = db.collection(SUBSCRIPTIONS_COLLECTION).doc(userId) as DocumentReference;
    const snap = await docRef.get();
    if (!snap.exists) return null;
    return snap.data() as SubscriptionDoc;
  }

  async getQuotaSnapshot(userId: string): Promise<QuotaSnapshot | null> {
    const subscription = await this.getSubscription(userId);
    if (!subscription) return null;
    return this.buildQuotaSnapshot(subscription);
  }

  async buildQuotaSnapshot(subscription: SubscriptionDoc): Promise<QuotaSnapshot | null> {
    const wallet = await this.getActiveWallet(subscription.user_id);
    const planConfig = getPlanConfigById(subscription.plan_id);
    const total = wallet?.quota_total ?? planConfig?.quota ?? 0;
    const used = wallet?.quota_used ?? 0;
    const remaining = Math.max(0, total - used);

    return {
      planId: subscription.plan_id,
      planKey: subscription.plan_key,
      cycle: subscription.cycle,
      isActive: subscription.is_active,
      willRenew: subscription.will_renew,
      periodStart: wallet?.period_start ?? subscription.current_period_start,
      periodEnd: wallet?.period_end ?? subscription.current_period_end,
      quotaTotal: total,
      quotaUsed: used,
      quotaRemaining: remaining,
      walletId: wallet?.id ?? null,
    };
  }

  async syncQuotaFromPlan(userId: string, planIdCandidate: string | null | undefined): Promise<void> {
    const planId = resolvePlanId(planIdCandidate);
    const planConfig = planId ? getPlanConfigById(planId) : null;
    if (!planConfig) {
      logger.info({ userId, planIdCandidate }, 'Quota sync skipped: unknown planId');
      return;
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const periodStart = nowIso;
    const periodEnd = planConfig.cycle === 'monthly'
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
      : new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate())).toISOString();

    const subscriptionRef = db.collection(SUBSCRIPTIONS_COLLECTION).doc(userId);
    await subscriptionRef.set(
      {
        id: userId,
        user_id: userId,
        platform: null,
        rc_app_user_id: null,
        product_id: planIdCandidate ?? null,
        plan_id: planConfig.planId,
        plan_key: planConfig.planKey,
        cycle: planConfig.cycle,
        entitlement_ids: [],
        is_active: planConfig.planId !== 'free',
        will_renew: planConfig.planId !== 'free',
        status: planConfig.planId !== 'free' ? 'active' : 'expired',
        current_period_start: periodStart,
        current_period_end: periodEnd,
        last_rc_event_at: nowIso,
        original_purchase_date: nowIso,
        updated_at: nowIso,
        created_at: nowIso,
      },
      { merge: true }
    );

    if (planConfig.planId !== 'free') {
      await this.openWalletForSubscription(
        {
          id: userId,
          user_id: userId,
          platform: null,
          rc_app_user_id: null,
          product_id: planIdCandidate ?? null,
          plan_id: planConfig.planId,
          plan_key: planConfig.planKey,
          cycle: planConfig.cycle,
          entitlement_ids: [],
          is_active: true,
          will_renew: true,
          status: 'active',
          current_period_start: periodStart,
          current_period_end: periodEnd,
          last_rc_event_at: nowIso,
          original_purchase_date: nowIso,
          updated_at: nowIso,
          created_at: nowIso,
        },
        true
      );
    }
  }

  async reserveUsage(
    userId: string,
    requestId: string,
    action: string,
    amount = 1
  ): Promise<ReserveResult> {
    if (!requestId) {
      return { allowed: false, status: 'rejected', remaining: 0, walletId: null };
    }

    const subscription = await this.getSubscription(userId);
    if (!subscription || !subscription.is_active) {
      return { allowed: false, status: 'rejected', remaining: 0, walletId: null };
    }

    const wallet = await this.ensureActiveWallet(userId, subscription);
    if (!wallet) {
      return { allowed: false, status: 'rejected', remaining: 0, walletId: null };
    }

    const walletRef = db.collection(WALLETS_COLLECTION).doc(wallet.id);
    const usageRef = db.collection(USAGES_COLLECTION).doc(`${userId}_${requestId}`);
    const nowIso = new Date().toISOString();

    return db.runTransaction(async (tx: Transaction) => {
      const [walletSnap, usageSnap] = await Promise.all([
        tx.get(walletRef),
        tx.get(usageRef as unknown as DocumentReference),
      ]);

      if (!walletSnap.exists) {
        return { allowed: false, status: 'rejected', remaining: 0, walletId: null };
      }

      const walletData = walletSnap.data() as QuotaWalletDoc;
      if (walletData.status !== 'active') {
        const remaining = Math.max(0, walletData.quota_total - walletData.quota_used);
        return {
          allowed: false,
          status: 'rejected',
          remaining,
          walletId: walletData.id,
        };
      }

      if (usageSnap.exists) {
        const existingUsage = usageSnap.data() as QuotaUsageDoc;
        const remaining = Math.max(0, walletData.quota_total - walletData.quota_used);
        return {
          allowed: existingUsage.status !== 'rolled_back',
          status: existingUsage.status,
          remaining,
          walletId: walletData.id,
        };
      }

      const nextUsed = walletData.quota_used + amount;
      if (nextUsed > walletData.quota_total) {
        const remaining = Math.max(0, walletData.quota_total - walletData.quota_used);
        return { allowed: false, status: 'rejected', remaining, walletId: walletData.id };
      }

      tx.update(walletRef, {
        quota_used: nextUsed,
        updated_at: nowIso,
        last_usage_at: nowIso,
      });

      tx.set(usageRef as unknown as DocumentReference, {
        id: `${userId}_${requestId}`,
        user_id: userId,
        wallet_id: walletData.id,
        request_id: requestId,
        action,
        amount,
        status: 'reserved',
        created_at: nowIso,
        updated_at: nowIso,
      });

      const remaining = Math.max(0, walletData.quota_total - nextUsed);
      return { allowed: true, status: 'reserved', remaining, walletId: walletData.id };
    });
  }

  async commitUsage(userId: string, requestId: string): Promise<UsageStatus | null> {
    if (!requestId) return null;
    const usageRef = db.collection(USAGES_COLLECTION).doc(`${userId}_${requestId}`);
    const nowIso = new Date().toISOString();

    return db.runTransaction(async (tx: Transaction) => {
      const usageSnap = await tx.get(usageRef as unknown as DocumentReference);
      if (!usageSnap.exists) return null;
      const usage = usageSnap.data() as QuotaUsageDoc;
      if (usage.status === 'committed') return 'committed';
      if (usage.status === 'rolled_back') return 'rolled_back';

      tx.update(usageRef, { status: 'committed', updated_at: nowIso });
      return 'committed';
    });
  }

  async rollbackUsage(userId: string, requestId: string): Promise<UsageStatus | null> {
    if (!requestId) return null;
    const usageRef = db.collection(USAGES_COLLECTION).doc(`${userId}_${requestId}`);
    const nowIso = new Date().toISOString();

    return db.runTransaction(async (tx: Transaction) => {
      const usageSnap = await tx.get(usageRef as unknown as DocumentReference);
      if (!usageSnap.exists) return null;
      const usage = usageSnap.data() as QuotaUsageDoc;
      if (usage.status === 'rolled_back') return 'rolled_back';
      if (usage.status === 'committed') return 'committed';

      const walletRef = db.collection(WALLETS_COLLECTION).doc(usage.wallet_id);
      const walletSnap = await tx.get(walletRef as unknown as DocumentReference);
      if (walletSnap.exists) {
        const wallet = walletSnap.data() as QuotaWalletDoc;
        const nextUsed = Math.max(0, wallet.quota_used - usage.amount);
        tx.update(walletRef, {
          quota_used: nextUsed,
          updated_at: nowIso,
        });
      }

      tx.update(usageRef, { status: 'rolled_back', updated_at: nowIso });
      return 'rolled_back';
    });
  }

  async getActiveWallet(userId: string): Promise<QuotaWalletDoc | null> {
    const snapshot = await db
      .collection(WALLETS_COLLECTION)
      .where('user_id', '==', userId)
      .where('status', '==', 'active')
      .orderBy('period_end', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { ...(doc.data() as QuotaWalletDoc), id: doc.id };
  }

  async ensureActiveWallet(userId: string, subscription: SubscriptionDoc): Promise<QuotaWalletDoc | null> {
    if (!subscription.is_active) return null;

    const now = new Date();
    const nowIso = now.toISOString();
    const planConfig = getPlanConfigById(subscription.plan_id);
    if (!planConfig) return null;

    const existingWallet = await this.getActiveWallet(userId);
    const currentEnd = subscription.current_period_end ? new Date(subscription.current_period_end) : null;

    if (existingWallet) {
      const walletEnd = existingWallet.period_end ? new Date(existingWallet.period_end) : null;
      const endDate = walletEnd ?? currentEnd;
      if (endDate && endDate > now) {
        return existingWallet;
      }
    }

    if (!subscription.current_period_start || !subscription.current_period_end) {
      logger.warn({ userId }, 'Subscription period missing; cannot open wallet');
      return existingWallet;
    }

    await this.closeWalletsForUser(userId, {
      reason: 'period_reset',
      setRemainingToZero: false,
    });

    return this.openWalletForSubscription(subscription, true);
  }

  async openWalletForSubscription(
    subscription: SubscriptionDoc,
    closeExisting = false
  ): Promise<QuotaWalletDoc | null> {
    const planConfig = getPlanConfigById(subscription.plan_id);
    if (!planConfig) return null;

    if (closeExisting) {
      await this.closeWalletsForUser(subscription.user_id, {
        reason: 'plan_change',
        setRemainingToZero: false,
      });
    }

    const nowIso = new Date().toISOString();
    const walletRef = db.collection(WALLETS_COLLECTION).doc();
    const wallet: QuotaWalletDoc = {
      id: walletRef.id,
      user_id: subscription.user_id,
      subscription_id: subscription.id,
      plan_id: subscription.plan_id,
      scope: planConfig.cycle,
      period_start: subscription.current_period_start,
      period_end: subscription.current_period_end,
      quota_total: planConfig.quota,
      quota_used: 0,
      status: 'active',
      last_usage_at: null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    await walletRef.set(wallet, { merge: true });
    return wallet;
  }

  async closeWalletsForUser(
    userId: string,
    options: { reason: string; setRemainingToZero: boolean }
  ): Promise<void> {
    const snapshot = await db
      .collection(WALLETS_COLLECTION)
      .where('user_id', '==', userId)
      .where('status', '==', 'active')
      .get();

    if (snapshot.empty) return;
    const nowIso = new Date().toISOString();
    const batch = db.batch();

    snapshot.docs.forEach((doc) => {
      const data = doc.data() as QuotaWalletDoc;
      batch.update(doc.ref, {
        status: 'closed',
        updated_at: nowIso,
        last_usage_at: data.last_usage_at ?? null,
        quota_used: options.setRemainingToZero ? data.quota_total : data.quota_used,
        closed_reason: options.reason,
      });
    });

    await batch.commit();
  }

  async processRevenueCatEvent(payload: RevenueCatEventContext): Promise<void> {
    const eventType = normalizeEventType(payload.eventType);
    const eventDocId = getWebhookEventId(payload);
    const webhookRef = db.collection(WEBHOOK_EVENTS_COLLECTION).doc(eventDocId);
    const nowIso = new Date().toISOString();

    let duplicate = false;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(webhookRef as unknown as DocumentReference);
      if (snap.exists) {
        duplicate = true;
        return;
      }
      tx.set(webhookRef as unknown as DocumentReference, {
        id: eventDocId,
        rc_event_id: payload.eventId ?? eventDocId,
        event_type: eventType,
        rc_app_user_id: payload.rcAppUserId ?? null,
        received_at: nowIso,
        processed_at: null,
        payload_json: JSON.stringify(payload.rawEvent ?? {}),
        status: 'received',
      });
    });

    if (duplicate) {
      logger.info({ eventDocId, eventType }, 'RevenueCat webhook duplicate ignored');
      return;
    }

    const subscriptionRef = db.collection(SUBSCRIPTIONS_COLLECTION).doc(payload.userId);
    const planConfig = resolvePlanConfig(payload.productId) ?? getPlanConfigById(payload.productId);

    let nextSubscription: SubscriptionDoc | null = null;
    let shouldOpenWallet = false;
    let shouldCloseWallet = false;
    let planChanged = false;
    let periodChanged = false;

    await db.runTransaction(async (tx) => {
      const existingSnap = await tx.get(subscriptionRef as unknown as DocumentReference);
      const existing = existingSnap.exists ? (existingSnap.data() as SubscriptionDoc) : null;
      const existingPlanId = existing?.plan_id ?? null;

      const nextPlan = planConfig ?? (existingPlanId ? getPlanConfigById(existingPlanId) : null);

      const status: SubscriptionStatus = (() => {
        if (isRefundEvent(eventType)) return 'refunded';
        if (isExpirationEvent(eventType)) return 'expired';
        if (isBillingIssueEvent(eventType)) return 'billing_issue';
        if (isCancellationEvent(eventType)) return 'cancelled';
        if (isPurchaseEvent(eventType)) return 'active';
        return existing?.status ?? 'active';
      })();

      const isActive = status === 'active' || status === 'cancelled';
      const willRenew =
        payload.willRenew !== null && payload.willRenew !== undefined
          ? payload.willRenew
          : status === 'active';

      const periodStart = payload.periodStart ?? existing?.current_period_start ?? null;
      const periodEnd = payload.periodEnd ?? existing?.current_period_end ?? null;

      planChanged = Boolean(nextPlan && existingPlanId && nextPlan.planId !== existingPlanId);
      periodChanged = Boolean(
        periodEnd && existing?.current_period_end && periodEnd !== existing.current_period_end
      );

      shouldOpenWallet = isActive && (isPurchaseEvent(eventType) || planChanged || periodChanged);
      shouldCloseWallet = shouldCloseWallet || (shouldCloseWalletStatus(status) && existing?.is_active);

      const updates: SubscriptionDoc = {
        id: payload.userId,
        user_id: payload.userId,
        platform: payload.platform ?? existing?.platform ?? null,
        rc_app_user_id: payload.rcAppUserId ?? existing?.rc_app_user_id ?? null,
        product_id: payload.productId ?? existing?.product_id ?? null,
        plan_id: nextPlan?.planId ?? existingPlanId ?? null,
        plan_key: nextPlan?.planKey ?? existing?.plan_key ?? null,
        cycle: nextPlan?.cycle ?? existing?.cycle ?? null,
        entitlement_ids: payload.entitlementIds ?? existing?.entitlement_ids ?? [],
        is_active: isActive,
        will_renew: willRenew,
        status,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        last_rc_event_at: nowIso,
        original_purchase_date: payload.originalPurchaseDate ?? existing?.original_purchase_date ?? null,
        updated_at: nowIso,
        created_at: existing?.created_at ?? nowIso,
      };

      tx.set(subscriptionRef as unknown as DocumentReference, updates, { merge: true });
      nextSubscription = updates;
    });

    if (nextSubscription && shouldCloseWallet) {
      await this.closeWalletsForUser(nextSubscription.user_id, {
        reason: nextSubscription.status,
        setRemainingToZero: true,
      });
    }

    if (nextSubscription && shouldOpenWallet) {
      await this.openWalletForSubscription(nextSubscription, planChanged || periodChanged);
    }

    await webhookRef.set(
      {
        processed_at: new Date().toISOString(),
        status: 'processed',
      },
      { merge: true }
    );
  }
}

export const quotaService = new QuotaService();
