import { logger } from '../utils/logger';

export type PlanCycle = 'monthly' | 'yearly';

export type PlanConfig = {
  planId: string;
  planKey: string;
  cycle: PlanCycle;
  quota: number;
  productIds: string[];
};

const DEFAULT_PLAN_CONFIG: PlanConfig[] = [
  {
    planId: 'free',
    planKey: 'free',
    cycle: 'monthly',
    quota: 2,
    productIds: [],
  },
  {
    planId: 'premium_monthly',
    planKey: 'base',
    cycle: 'monthly',
    quota: 100,
    productIds: ['ai_or_real_premium:aiorreal-monthly', 'aiorreal-monthly'],
  },
  {
    planId: 'premium_yearly',
    planKey: 'pro',
    cycle: 'yearly',
    quota: 1000,
    productIds: ['ai_or_real_premium:aiorreal-yearly', 'aiorreal-yearly'],
  },
];

const parsePlanConfig = (rawValue: string | undefined): PlanConfig[] => {
  if (!rawValue) return DEFAULT_PLAN_CONFIG;

  try {
    const parsed = JSON.parse(rawValue);
    if (Array.isArray(parsed)) {
      return parsed as PlanConfig[];
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.plans)) {
      return parsed.plans as PlanConfig[];
    }
    logger.warn('Invalid QUOTA_PLAN_CONFIG format; falling back to defaults');
    return DEFAULT_PLAN_CONFIG;
  } catch (error) {
    logger.warn({ err: error }, 'Failed to parse QUOTA_PLAN_CONFIG; falling back to defaults');
    return DEFAULT_PLAN_CONFIG;
  }
};

export const PLAN_CONFIG = parsePlanConfig(process.env.QUOTA_PLAN_CONFIG);

export const resolvePlanConfig = (candidate: string | null | undefined): PlanConfig | null => {
  if (!candidate) return null;
  const normalized = candidate.toLowerCase().trim();
  if (!normalized) return null;

  if (normalized.includes('aiorreal-monthly')) {
    return getPlanConfigById('premium_monthly');
  }
  if (normalized.includes('aiorreal-yearly') || normalized.includes('aiorreal-annual')) {
    return getPlanConfigById('premium_yearly');
  }

  for (const plan of PLAN_CONFIG) {
    if (plan.planId.toLowerCase() === normalized) return plan;
  }

  for (const plan of PLAN_CONFIG) {
    if (plan.productIds.some((id) => normalized.includes(id.toLowerCase()))) {
      return plan;
    }
  }

  return null;
};

export const getPlanConfigById = (planId: string | null | undefined): PlanConfig | null => {
  if (!planId) return null;
  const normalized = planId.toLowerCase().trim();
  return PLAN_CONFIG.find((plan) => plan.planId.toLowerCase() === normalized) || null;
};
