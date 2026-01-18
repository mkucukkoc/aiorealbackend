import { Router, Request, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { authRateLimits } from '../middleware/rateLimitMiddleware';
import { validate, deleteAccountSchemas, validateParams } from '../middleware/validationMiddleware';
import { deleteAccountService, DeleteAccountError } from '../services/deleteAccountService';
import { dataExportService } from '../services/dataExportService';
import { DeleteAccountRequestBody } from '../types/deleteAccount';
import { ResponseBuilder } from '../types/response';
import { logger } from '../utils/logger';
import { attachRouteLogger } from '../utils/routeLogger';
import { config } from '../config';

export function createDeleteAccountRouter(): Router {
  const r = Router();
  attachRouteLogger(r, 'deleteAccount');

  r.post(
    '/',
    authRateLimits.deleteAccount,
    authenticateToken,
    validate(deleteAccountSchemas.initiate),
    async (req: Request, res: Response) => {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        logger.warn('Delete account attempt without auth');
        return res.status(401).json(ResponseBuilder.error('unauthorized', 'Authentication required'));
      }

      const body = req.body as DeleteAccountRequestBody;
      logger.info(
        {
          userId: authReq.user.id,
          body,
          ip: req.ip,
        },
        'Delete account request initiated'
      );

      try {
        const result = await deleteAccountService.initiateDeletion(authReq.user.id, body, {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent') || undefined,
          country: req.get('x-country') || undefined,
          city: req.get('x-city') || undefined,
        });
        logger.info({ userId: authReq.user.id, jobId: result.jobId }, 'Delete account initiated successfully');
        return res
          .status(202)
          .json(ResponseBuilder.success(result, 'Delete account işlemi başlatıldı'));
      } catch (error) {
        logger.error({ err: error, userId: authReq.user.id }, 'Delete account initiation failed');
        return handleDeleteAccountError(res, error);
      }
    }
  );

  r.post(
    '/export',
    authenticateToken,
    validate(deleteAccountSchemas.dataExport),
    async (req: Request, res: Response) => {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        logger.warn('Data export attempt without auth');
        return res.status(401).json(ResponseBuilder.error('unauthorized', 'Authentication required'));
      }

      logger.debug(
        {
          userId: authReq.user.id,
          dataExportEnabled: config.deleteAccount.dataExportEnabled,
          envValue: process.env.DELETE_DATA_EXPORT_ENABLED,
        },
        'Data export endpoint check'
      );

      if (!config.deleteAccount.dataExportEnabled) {
        logger.warn(
          {
            userId: authReq.user.id,
            envValue: process.env.DELETE_DATA_EXPORT_ENABLED,
          },
          'Data export disabled - returning 403'
        );
        return res
          .status(403)
          .json(
            ResponseBuilder.error(
              'EXPORT_DISABLED',
              'Veri indirme özelliği bu ortamda devre dışı bırakıldı'
            )
          );
      }

      logger.info({ userId: authReq.user.id }, 'Data export request started');

      try {
        const archive = await dataExportService.generateUserExport(authReq.user.id);
        logger.info({ userId: authReq.user.id, archiveFile: archive.fileName }, 'Data export succeeded');
        return res.json(ResponseBuilder.success(archive, 'Veri arşiviniz hazır'));
      } catch (error) {
        logger.error({ err: error, userId: authReq.user.id }, 'Data export failed');
        return res
          .status(500)
          .json(ResponseBuilder.error('EXPORT_FAILED', 'Veri arşivi oluşturulamadı'));
      }
    }
  );

  r.post(
    '/restore',
    authenticateToken,
    validate(deleteAccountSchemas.restore),
    async (req: Request, res: Response) => {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        logger.warn('Restore account attempt without auth');
        return res.status(401).json(ResponseBuilder.error('unauthorized', 'Authentication required'));
      }

      logger.info({ userId: authReq.user.id }, 'Restore account request started');
      try {
        const result = await deleteAccountService.restoreAccount(authReq.user.id, {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent') || undefined,
        });
        logger.info({ userId: authReq.user.id, restoredAt: result.restoredAt }, 'Account restored successfully');
        logger.debug({ userId: authReq.user.id, response: result }, 'Restore endpoint response payload');
        return res.json(ResponseBuilder.success(result, 'Hesap geri alındı'));
      } catch (error) {
        logger.error({ err: error, userId: authReq.user.id }, 'Restore account failed');
        return handleDeleteAccountError(res, error);
      }
    }
  );

  r.get(
    '/jobs/:jobId',
    authenticateToken,
    validateParams(deleteAccountSchemas.jobParams),
    async (req: Request, res: Response) => {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        logger.warn('Job status request without auth');
        return res.status(401).json(ResponseBuilder.error('unauthorized', 'Authentication required'));
      }
      const { jobId } = req.params;
      logger.info({ userId: authReq.user.id, jobId }, 'Fetching delete job status');
      try {
        const job = await deleteAccountService.getJob(jobId);
        if (!job || job.userId !== authReq.user.id) {
          logger.warn({ userId: authReq.user.id, jobId }, 'Delete job not found or unauthorized');
          return res
            .status(404)
            .json(ResponseBuilder.error('JOB_NOT_FOUND', 'Silme kaydı bulunamadı'));
        }
        logger.info({ userId: authReq.user.id, jobId, status: job.status }, 'Delete job found');
        logger.debug({ userId: authReq.user.id, job }, 'Delete job response payload');
        return res.json(ResponseBuilder.success(job));
      } catch (error) {
        logger.error({ err: error, jobId }, 'Failed to fetch delete job');
        return res
          .status(500)
          .json(ResponseBuilder.error('JOB_LOOKUP_FAILED', 'İşlem geçmişi alınamadı'));
      }
    }
  );

  r.get('/jobs/latest', authenticateToken, async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      logger.warn('Latest job request without auth');
      return res.status(401).json(ResponseBuilder.error('unauthorized', 'Authentication required'));
    }

    logger.info({ userId: authReq.user.id }, 'Fetching latest delete job');

    try {
      const job = await deleteAccountService.getLatestJobForUser(authReq.user.id);
      if (!job) {
        logger.warn({ userId: authReq.user.id }, 'No delete job history found');
        return res
          .status(404)
          .json(ResponseBuilder.error('JOB_NOT_FOUND', 'Herhangi bir silme kaydı yok'));
      }
      logger.info({ userId: authReq.user.id, jobId: job.id, status: job.status }, 'Latest delete job returned');
      logger.debug({ userId: authReq.user.id, job }, 'Latest job response payload');
      return res.json(ResponseBuilder.success(job));
    } catch (error) {
      logger.error({ err: error, userId: authReq.user.id }, 'Failed to fetch latest job');
      return res
        .status(500)
        .json(ResponseBuilder.error('JOB_LOOKUP_FAILED', 'İşlem geçmişi alınamadı'));
    }
  });

  return r;
}

function handleDeleteAccountError(res: Response, error: unknown) {
  if (error instanceof DeleteAccountError) {
    return res.status(error.status).json(ResponseBuilder.error(error.code, error.message, error.details));
  }
  logger.error({ err: error }, 'Delete account endpoint failed');
  return res
    .status(500)
    .json(ResponseBuilder.error('DELETE_FAILED', 'Delete account işlemi tamamlanamadı'));
}


