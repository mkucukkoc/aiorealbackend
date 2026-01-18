import { Router, Request, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { validate, premiumSchemas } from '../middleware/validationMiddleware';
import { ResponseBuilder } from '../types/response';
import { premiumService, PremiumServiceError } from '../services/premiumService';
import { logger } from '../utils/logger';
import { attachRouteLogger } from '../utils/routeLogger';

const normalizeEmail = (val: any): string | null => {
  if (!val || typeof val !== 'string') {
    return null;
  }
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
};

export function createPremiumRouter(): Router {
  const router = Router();
  attachRouteLogger(router, 'premium');

  const logStep = (step: string, data: Record<string, unknown>) => {
    logger.info({ step, ...data }, '[PremiumRoute]');
  };

  router.post(
    '/customer-info',
    authenticateToken,
    validate(premiumSchemas.customerInfo),
    async (req: Request, res: Response) => {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        logStep('customer_info_unauthorized', { path: '/customer-info' });
        return res.status(401).json(ResponseBuilder.error('unauthorized', 'Authentication required'));
      }

      logStep('customer_info_request', {
        userId: authReq.user.id,
        payloadSource: req.body?.source,
        payloadPlatform: req.body?.platform,
      });

      try {
        const result = await premiumService.syncFromCustomerInfo(authReq.user.id, req.body);
        logStep('customer_info_success', {
          userId: authReq.user.id,
          premium: result.premium,
          payloadKeys: Object.keys(req.body ?? {}),
        });
        const responsePayload = ResponseBuilder.success(result, 'Premium bilgileri güncellendi');
        logStep('customer_info_response', { userId: authReq.user.id, response: responsePayload });
        return res.json(responsePayload);
      } catch (error) {
        logStep('customer_info_error', {
          userId: authReq.user.id,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return handlePremiumError(res, error);
      }
    }
  );

  router.post(
    '/restore',
    authenticateToken,
    validate(premiumSchemas.restore),
    async (req: Request, res: Response) => {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        logStep('restore_unauthorized', { path: '/restore' });
        return res.status(401).json(ResponseBuilder.error('unauthorized', 'Authentication required'));
      }

      const requestedEmail =
        normalizeEmail(req.body?.email) ||
        normalizeEmail(authReq.user.email) ||
        null;
      const requestId = req.body?.requestId;
      const platform = req.body?.platform;
      const source = req.body?.source;

      if (!requestedEmail) {
        logStep('restore_missing_email', {
          userId: authReq.user.id,
          bodyKeys: Object.keys(req.body ?? {}),
        });
        return res
          .status(400)
          .json(ResponseBuilder.error('EMAIL_REQUIRED', 'Premium restore işlemi için e-posta gereklidir'));
      }
      logStep('restore_request', {
        userId: authReq.user.id,
        requestedEmail,
        platform,
        source,
        hasOldAppUserId: Boolean(req.body?.oldAppUserId),
      });

      try {
        if (req.body?.oldAppUserId) {
          const restoreResult = await premiumService.restoreTransferredSubscription({
            currentUid: authReq.user.id,
            email: requestedEmail,
            oldAppUserId: req.body.oldAppUserId,
            requestId,
            platform,
          });
          logStep('restore_transfer_success', {
            userId: authReq.user.id,
            requestedEmail,
            premium: restoreResult.premium,
          });
          const responsePayload = ResponseBuilder.success(
            restoreResult,
            restoreResult.premium
              ? 'Satın almalarınız yeni hesabınıza taşındı'
              : 'Aktif abonelik bulunamadı'
          );
          logStep('restore_response', {
            userId: authReq.user.id,
            responseStatus: restoreResult.premium ? 'premium_restored' : 'premium_not_found',
          });
          return res.json(responsePayload);
        }

        const result = await premiumService.restoreFromRevenueCat(authReq.user.id, {
          appUserId: requestedEmail,
          requestId,
          source: source || 'restore_endpoint',
        });
        logStep('restore_revenuecat_success', {
          userId: authReq.user.id,
          requestedEmail,
          premium: result.premium,
        });
        const responsePayload = ResponseBuilder.success(
          result,
          result.premium ? 'Satın almalarınız geri yüklendi' : 'Aktif abonelik bulunamadı'
        );
        logStep('restore_response', {
          userId: authReq.user.id,
          responseStatus: result.premium ? 'premium_restored' : 'premium_not_found',
        });
        return res.json(responsePayload);
      } catch (error) {
        logStep('restore_error', {
          userId: authReq.user.id,
          requestedEmail,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return handlePremiumError(res, error);
      }
    }
  );

  router.post(
    '/sync',
    authenticateToken,
    validate(premiumSchemas.restore),
    async (req: Request, res: Response) => {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        logStep('sync_unauthorized', { path: '/sync' });
        return res.status(401).json(ResponseBuilder.error('unauthorized', 'Authentication required'));
      }

      logStep('sync_request', {
        userId: authReq.user.id,
        payloadKeys: Object.keys(req.body ?? {}),
      });

      try {
        const requestedEmail =
          normalizeEmail(req.body?.appUserId) ||
          normalizeEmail(authReq.user.email) ||
          null;

        const result = await premiumService.syncFromRevenueCat(authReq.user.id, {
          appUserId: requestedEmail || undefined,
          requestId: req.body?.requestId,
          source: req.body?.source,
        });
        logStep('sync_success', {
          userId: authReq.user.id,
          premium: result.premium,
          requestedEmail,
        });
        const responsePayload = ResponseBuilder.success(
          result,
          'Premium bilgileri RevenueCat ile senkronize edildi'
        );
        logStep('sync_response', { userId: authReq.user.id });
        return res.json(responsePayload);
      } catch (error) {
        logStep('sync_error', {
          userId: authReq.user.id,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return handlePremiumError(res, error);
      }
    }
  );

  router.get('/status', authenticateToken, async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      logStep('status_unauthorized', { path: '/status' });
      return res.status(401).json(ResponseBuilder.error('unauthorized', 'Authentication required'));
    }

    try {
      const status = await premiumService.getStatus(authReq.user.id);
      if (!status) {
        logStep('status_not_found', { userId: authReq.user.id });
        return res.status(404).json(ResponseBuilder.error('NOT_FOUND', 'Premium kaydı bulunamadı'));
      }
      logStep('status_success', {
        userId: authReq.user.id,
        premium: status?.premium,
        expiresAt: status?.premiumExpiresAt,
      });
      const responsePayload = ResponseBuilder.success(status);
      logStep('status_response', { userId: authReq.user.id });
      return res.json(responsePayload);
    } catch (error) {
      logStep('status_error', {
        userId: authReq.user.id,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json(ResponseBuilder.error('PREMIUM_STATUS_FAILED', 'Premium durumu alınamadı'));
    }
  });

  return router;
}

function handlePremiumError(res: Response, error: any) {
  if (error instanceof PremiumServiceError) {
    const logPayload = { err: error, code: error.code };
    if (error.code === 'ENTITLEMENT_NOT_FOUND') {
      logger.info(logPayload, 'Premium service info: entitlement not found');
    } else {
      logger.warn(logPayload, 'Premium service error');
    }
    return res.status(error.status).json(ResponseBuilder.error(error.code, error.message));
  }

  logger.error({ err: error }, 'Premium endpoint failure');
  return res.status(500).json(ResponseBuilder.error('PREMIUM_OPERATION_FAILED', 'Premium işlemi tamamlanamadı'));
}

