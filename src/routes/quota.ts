import { Router, Request, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { ResponseBuilder } from '../types/response';
import { quotaService } from '../services/quotaService';
import { premiumService } from '../services/premiumService';
import { aiUserLimiter } from '../middleware/rateLimits';

export function createQuotaRouter(): Router {
  const router = Router();

  router.get('/', authenticateToken, aiUserLimiter, async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json(ResponseBuilder.error('unauthorized', 'Authentication required'));
    }

    try {
      let snapshot = await quotaService.getQuotaSnapshot(authReq.user.id);
      if (!snapshot) {
        const premiumStatus = await premiumService.getStatus(authReq.user.id);
        await quotaService.ensureQuotaForUser(authReq.user.id, {
          premium: premiumStatus?.premium,
          entitlementProductId: premiumStatus?.entitlementProductId ?? null,
        });
        snapshot = await quotaService.getQuotaSnapshot(authReq.user.id);
      }
      if (!snapshot) {
        return res.status(404).json({
          code: 'QUOTA_NOT_FOUND',
          message: 'Quota not found',
        });
      }

      return res.json(snapshot);
    } catch (error) {
      return res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    }
  });

  router.post('/consume', authenticateToken, aiUserLimiter, async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json(ResponseBuilder.error('unauthorized', 'Authentication required'));
    }

    const requestIdHeader = req.headers['x-request-id'];
    const requestId =
      (Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader) ||
      req.body?.requestId ||
      null;

    if (!requestId || typeof requestId !== 'string') {
      return res.status(400).json(
        ResponseBuilder.error('request_id_required', 'request_id zorunludur', {
          header: 'x-request-id',
        })
      );
    }

    try {
      const reserveResult = await quotaService.reserveUsage(authReq.user.id, requestId, 'ai_detect');
      if (!reserveResult.allowed) {
        return res.status(429).json(
          ResponseBuilder.error('QUOTA_EXCEEDED', 'Quota limit reached', {
            remaining: reserveResult.remaining,
          })
        );
      }

      return res.json(
        ResponseBuilder.success(
          {
            requestId,
            walletId: reserveResult.walletId,
            remaining: reserveResult.remaining,
          },
          'Quota reserved'
        )
      );
    } catch (error) {
      return res.status(500).json(
        ResponseBuilder.error('INTERNAL_ERROR', 'Internal server error', {
          error,
        })
      );
    }
  });

  return router;
}
