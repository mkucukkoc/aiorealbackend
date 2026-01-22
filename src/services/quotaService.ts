import { db } from '../firebase';
import type { Transaction, DocumentReference, DocumentSnapshot } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';

type CycleUnit = 'month';

type PlanQuota = {
  imagesPerCycle: number;
  cycle: CycleUnit;
};

export const PLAN_QUOTAS: Record<string, PlanQuota> = {
  free: { imagesPerCycle: 2, cycle: 'month' },
  premium_base_monthly: { imagesPerCycle: 100, cycle: 'month' },
  premium_pro_monthly: { imagesPerCycle: 400, cycle: 'month' },
  premium_base_yearly: { imagesPerCycle: 100, cycle: 'month' },
  premium_pro_yearly: { imagesPerCycle: 300, cycle: 'month' },
};

const QUOTA_COLLECTION = 'users_quato';

export type QuotaDoc = {
  planId: string;
  cycle: CycleUnit;
  cycleStart: string;
  cycleEnd: string;
  imagesLimit: number;
  imagesUsed: number;
  updatedAt: string;
};

const getMonthCycle = (now: Date) => {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
};

const computeCycle = (cycle: CycleUnit, now: Date) => {
  if (cycle === 'month') {
    return getMonthCycle(now);
  }
  return getMonthCycle(now);
};

const normalizePlanId = (value: string) => value.toLowerCase().trim();

export const resolvePlanId = (candidate: string | null | undefined) => {
  if (!candidate) return null;
  const normalized = normalizePlanId(candidate);
  if (PLAN_QUOTAS[normalized]) {
    return normalized;
  }
  const match = Object.keys(PLAN_QUOTAS).find((planId) => normalized.includes(planId));
  return match || null;
};

class QuotaService {
  async ensureQuotaForUser(
    userId: string,
    premiumStatus?: { premium?: boolean; entitlementProductId?: string | null }
  ): Promise<QuotaDoc | null> {
    const existing = await this.getQuota(userId);
    if (existing) {
      return existing;
    }
    if (premiumStatus?.premium) {
      const planId = resolvePlanId(premiumStatus.entitlementProductId ?? null);
      if (planId) {
        return this.syncQuotaFromPlan(userId, planId);
      }
      return null;
    }
    return this.syncQuotaFromPlan(userId, 'free');
  }

  async getQuota(userId: string): Promise<QuotaDoc | null> {
    const docRef = db.collection(QUOTA_COLLECTION).doc(userId) as DocumentReference;
    const snap = await docRef.get();
    if (!snap.exists) {
      return null;
    }
    return snap.data() as QuotaDoc;
  }

  async syncQuotaFromPlan(userId: string, planIdCandidate: string | null | undefined): Promise<QuotaDoc | null> {
    const planId = resolvePlanId(planIdCandidate);
    if (!planId) {
      logger.info({ userId, planIdCandidate }, 'Quota sync skipped: unknown planId');
      return null;
    }

    const planQuota = PLAN_QUOTAS[planId];
    const now = new Date();
    const { start, end } = computeCycle(planQuota.cycle, now);

    const docRef = db.collection(QUOTA_COLLECTION).doc(userId);
    const existingSnap = await docRef.get();
    const existing = existingSnap.exists ? (existingSnap.data() as Partial<QuotaDoc>) : null;

    const previousCycleEnd = existing?.cycleEnd ? new Date(existing.cycleEnd) : null;
    const shouldReset = !previousCycleEnd || Number.isNaN(previousCycleEnd.getTime()) || previousCycleEnd <= now;

    const imagesUsed = shouldReset ? 0 : Number(existing?.imagesUsed || 0);

    const payload: QuotaDoc = {
      planId,
      cycle: planQuota.cycle,
      cycleStart: start.toISOString(),
      cycleEnd: end.toISOString(),
      imagesLimit: planQuota.imagesPerCycle,
      imagesUsed,
      updatedAt: now.toISOString(),
    };

    await docRef.set(payload, { merge: true });
    return payload;
  }

  async consumeImage(userId: string): Promise<{ allowed: boolean; quota: QuotaDoc; remaining: number }> {
    const docRef = db.collection(QUOTA_COLLECTION).doc(userId);
    const now = new Date();

    return db.runTransaction(async (tx: Transaction) => {
      const snap = (await tx.get(docRef)) as DocumentSnapshot;
      const existing = snap.exists ? (snap.data() as Partial<QuotaDoc>) : null;
      const resolvedPlanId = resolvePlanId(existing?.planId ?? null) || 'free';
      const planQuota = PLAN_QUOTAS[resolvedPlanId];
      const { start, end } = computeCycle(planQuota.cycle, now);

      const existingEnd = existing?.cycleEnd ? new Date(existing.cycleEnd) : null;
      const shouldReset = !existingEnd || Number.isNaN(existingEnd.getTime()) || existingEnd <= now;
      const baseUsed = shouldReset ? 0 : Number(existing?.imagesUsed || 0);
      const imagesLimit = planQuota.imagesPerCycle;
      const remaining = Math.max(0, imagesLimit - baseUsed);

      const payload: QuotaDoc = {
        planId: resolvedPlanId,
        cycle: planQuota.cycle,
        cycleStart: start.toISOString(),
        cycleEnd: end.toISOString(),
        imagesLimit,
        imagesUsed: baseUsed,
        updatedAt: now.toISOString(),
      };

      if (remaining <= 0) {
        tx.set(docRef, payload, { merge: true });
        return { allowed: false, quota: payload, remaining: 0 };
      }

      payload.imagesUsed = baseUsed + 1;
      payload.updatedAt = now.toISOString();
      tx.set(docRef, payload, { merge: true });
      const remainingAfter = Math.max(0, imagesLimit - payload.imagesUsed);
      return { allowed: true, quota: payload, remaining: remainingAfter };
    });
  }

  async releaseImage(userId: string): Promise<void> {
    const docRef = db.collection(QUOTA_COLLECTION).doc(userId) as DocumentReference;
    const now = new Date();

    await db.runTransaction(async (tx: Transaction) => {
      const snap = (await tx.get(docRef)) as DocumentSnapshot;
      if (!snap.exists) {
        return;
      }
      const existing = snap.data() as Partial<QuotaDoc>;
      const resolvedPlanId = resolvePlanId(existing?.planId ?? null) || 'free';
      const planQuota = PLAN_QUOTAS[resolvedPlanId];
      const { start, end } = computeCycle(planQuota.cycle, now);

      const existingEnd = existing?.cycleEnd ? new Date(existing.cycleEnd) : null;
      const shouldReset = !existingEnd || Number.isNaN(existingEnd.getTime()) || existingEnd <= now;
      const baseUsed = shouldReset ? 0 : Number(existing?.imagesUsed || 0);
      const nextUsed = Math.max(0, baseUsed - 1);

      const payload: QuotaDoc = {
        planId: resolvedPlanId,
        cycle: planQuota.cycle,
        cycleStart: start.toISOString(),
        cycleEnd: end.toISOString(),
        imagesLimit: planQuota.imagesPerCycle,
        imagesUsed: nextUsed,
        updatedAt: now.toISOString(),
      };

      tx.set(docRef, payload, { merge: true });
    });
  }
}

export const quotaService = new QuotaService();
