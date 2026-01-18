import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

type BillingRetryState = {
  billingIssuesDetectedAt: string | null;
  unsubscribeDetectedAt: string | null;
  gracePeriodExpiresAt: string | null;
};

export interface RevenueCatCheckResult {
  hasActiveSubscription: boolean;
  entitlements: string[];
  blockingEntitlements: string[];
  expirationDates: Record<string, string | null>;
  isSandboxOnly: boolean;
  billingIssuesDetected?: boolean;
  gracePeriodActive?: boolean;
  billingRetryStates?: Record<string, BillingRetryState>;
  raw?: any;
}

class RevenueCatService {
  private baseUrl = config.revenueCat.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');

  private get headers() {
    if (!config.revenueCat.apiKey) {
      throw new Error('Missing RevenueCat API key');
    }

    return {
      Authorization: `Bearer ${config.revenueCat.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async fetchSubscriber(appUserId: string): Promise<any> {
    try {
      const url = `${this.baseUrl}/v1/subscribers/${encodeURIComponent(appUserId)}`;
      const response = await axios.get(url, {
        headers: this.headers,
        timeout: config.revenueCat.timeoutMs,
      });

      return response.data;
    } catch (error) {
      logger.error(
        {
          err: error,
          appUserId,
          operation: 'revenuecat.fetchSubscriber',
        },
        'Failed to fetch subscriber from RevenueCat'
      );
      throw error;
    }
  }

  async createAlias(sourceAppUserId: string, targetAppUserId: string): Promise<void> {
    if (!config.revenueCat.apiKey) {
      throw new Error('Missing RevenueCat API key');
    }

    if (!sourceAppUserId || !targetAppUserId || sourceAppUserId === targetAppUserId) {
      return;
    }

    const url = `${this.baseUrl}/v1/subscribers/${encodeURIComponent(sourceAppUserId)}/alias`;
    try {
      await axios.post(
        url,
        { new_app_user_id: targetAppUserId },
        {
          headers: this.headers,
          timeout: config.revenueCat.timeoutMs,
        }
      );
      logger.info({ sourceAppUserId, targetAppUserId }, 'RevenueCat alias created successfully');
    } catch (error) {
      logger.error({ err: error, sourceAppUserId, targetAppUserId }, 'Failed to create RevenueCat alias');
      throw error;
    }
  }

  async checkActiveSubscription(appUserId: string): Promise<RevenueCatCheckResult> {
    if (!config.revenueCat.apiKey) {
      logger.warn(
        {
          appUserId,
        },
        'RevenueCat API key missing, skipping subscription validation'
      );
      return {
        hasActiveSubscription: false,
        entitlements: [],
        blockingEntitlements: [],
        expirationDates: {},
        isSandboxOnly: false,
      };
    }

    const payload = await this.fetchSubscriber(appUserId);
    const entitlements = payload?.subscriber?.entitlements || {};
    const subscriptions = payload?.subscriber?.subscriptions || {};

    const now = Date.now();
    const expirationDates: Record<string, string | null> = {};
    const blockingEntitlements: string[] = [];
    const entitlementNames: string[] = [];
    let hasActive = false;
    let sandboxOnly = true;
    let gracePeriodActive = false;
    let billingIssuesDetected = false;
    const billingRetryStates: Record<string, BillingRetryState> = {};

    Object.entries<any>(entitlements).forEach(([name, entitlement]) => {
      entitlementNames.push(name);
      const expiresDate = this.getExpiration(entitlement);
      const graceExpires = this.getGraceExpiration(entitlement);
      const isSandboxEnt = entitlement?.environment === 'sandbox';

      if (!isSandboxEnt) {
        sandboxOnly = false;
      }

      expirationDates[name] = this.getExpirationValue(entitlement);

      if (graceExpires && graceExpires > now) {
        gracePeriodActive = true;
      }

      const isActive =
        (expiresDate && expiresDate > now) ||
        (graceExpires && graceExpires > now) ||
        entitlement?.is_active === true;
      if (isActive) {
        hasActive = true;
        blockingEntitlements.push(name);
      }
    });

    Object.entries<any>(subscriptions).forEach(([productId, subscription]) => {
      const isSandboxSub = subscription?.environment === 'sandbox';
      if (!isSandboxSub) {
        sandboxOnly = false;
      }

      const billingIssuesDetectedAt = subscription?.billing_issues_detected_at || null;
      const unsubscribeDetectedAt = subscription?.unsubscribe_detected_at || subscription?.unsubscribed_at || null;
      const graceExpiresAt = this.getGraceExpiration(subscription);
      if (billingIssuesDetectedAt || unsubscribeDetectedAt) {
        billingIssuesDetected = true;
      }

      billingRetryStates[productId] = {
        billingIssuesDetectedAt,
        unsubscribeDetectedAt,
        gracePeriodExpiresAt: graceExpiresAt ? new Date(graceExpiresAt).toISOString() : null,
      };
    });

    if (config.revenueCat.enforceRealMode !== false && sandboxOnly && hasActive) {
      // Treat sandbox-only entitlements as non-blocking if enforcement enabled
      hasActive = false;
      blockingEntitlements.length = 0;
    }

    return {
      hasActiveSubscription: hasActive,
      entitlements: entitlementNames,
      blockingEntitlements,
      expirationDates,
      isSandboxOnly: sandboxOnly,
      gracePeriodActive,
      billingIssuesDetected,
      billingRetryStates,
      raw: payload,
    };
  }

  private getExpirationValue(entitlement: any): string | null {
    return (
      entitlement?.expires_date ||
      entitlement?.expiration_date ||
      entitlement?.expiresDate ||
      entitlement?.expirationDate ||
      entitlement?.expirationAt ||
      entitlement?.expires_at ||
      null
    );
  }

  private getExpiration(entitlement: any): number | null {
    const rawValue = this.getExpirationValue(entitlement);
    if (!rawValue) {
      return null;
    }
    const ts = new Date(rawValue).getTime();
    return Number.isNaN(ts) ? null : ts;
  }

  private getGraceExpiration(source: any): number | null {
    const rawValue =
      source?.grace_period_expires_date ||
      source?.gracePeriodExpiresDate ||
      source?.grace_period_expires_at ||
      source?.gracePeriodExpiresAt ||
      null;
    if (!rawValue) {
      return null;
    }
    const ts = new Date(rawValue).getTime();
    return Number.isNaN(ts) ? null : ts;
  }
}

export const revenueCatService = new RevenueCatService();

