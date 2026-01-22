import { Router, Request, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { ResponseBuilder } from '../types/response';
import { quotaService } from '../services/quotaService';
import { premiumService } from '../services/premiumService';

export function createQuotaRouter(): Router {
  const router = Router();

  router.get('/', authenticateToken, async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json(ResponseBuilder.error('unauthorized', 'Authentication required'));
    }

    try {
      const premiumStatus = await premiumService.getStatus(authReq.user.id);
      const quota = await quotaService.ensureQuotaForUser(authReq.user.id, {
        premium: premiumStatus?.premium,
        entitlementProductId: premiumStatus?.entitlementProductId ?? null,
      });
      if (!quota) {
        return res.status(404).json({
          code: 'QUOTA_NOT_FOUND',
          message: 'Quota not found',
        });
      }

      const remaining = Math.max(0, quota.imagesLimit - quota.imagesUsed);
      return res.json({
        planId: quota.planId,
        cycle: quota.cycle,
        cycleStart: quota.cycleStart,
        cycleEnd: quota.cycleEnd,
        imagesLimit: quota.imagesLimit,
        imagesUsed: quota.imagesUsed,
        remaining,
      });
    } catch (error) {
      return res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    }
  });

  return router;
}
