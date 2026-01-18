import { logger } from '../utils/logger';

export interface ThirdPartyCleanupPayload {
  userId: string;
  email?: string;
  reason?: string;
  deletedAt: string;
}

class ThirdPartyIntegrationService {
  async anonymizeInCrm(payload: ThirdPartyCleanupPayload): Promise<void> {
    if (!process.env.CRM_WEBHOOK_URL) {
      logger.debug(
        { userId: payload.userId },
        'CRM webhook not configured, skipping anonymization'
      );
      return;
    }

    try {
      logger.info(
        { userId: payload.userId },
        'Forwarding deletion payload to CRM webhook (mocked)'
      );
      // Placeholder for actual HTTP POST
    } catch (error) {
      logger.error(
        { err: error, userId: payload.userId },
        'Failed to notify CRM webhook'
      );
      throw error;
    }
  }

  async purgeAnalyticsProfile(payload: ThirdPartyCleanupPayload): Promise<void> {
    if (!process.env.ANALYTICS_WEBHOOK_URL) {
      return;
    }

    try {
      logger.info(
        { userId: payload.userId },
        'Forwarding deletion payload to analytics webhook (mocked)'
      );
    } catch (error) {
      logger.error(
        { err: error, userId: payload.userId },
        'Failed to notify analytics webhook'
      );
    }
  }

  async notifySupportDesk(payload: ThirdPartyCleanupPayload): Promise<void> {
    if (!process.env.SUPPORT_WEBHOOK_URL) {
      return;
    }

    try {
      logger.info(
        { userId: payload.userId },
        'Forwarding deletion payload to support webhook (mocked)'
      );
    } catch (error) {
      logger.error(
        { err: error, userId: payload.userId },
        'Failed to notify support webhook'
      );
    }
  }
}

export const thirdPartyIntegrationService = new ThirdPartyIntegrationService();

