import { Router } from 'express';
import { PasswordResetService } from '../services/passwordResetService';
import { validate, authSchemas } from '../middleware/validationMiddleware';
import { authRateLimits } from '../middleware/rateLimitMiddleware';
import { auditService } from '../services/auditService';
import { logger } from '../utils/logger';
import { attachRouteLogger } from '../utils/routeLogger';

export function createPasswordResetRouter(): Router {
  const r = Router();
  attachRouteLogger(r, 'passwordReset');

  // POST /auth/password-reset/request
  r.post('/request',
    authRateLimits.passwordReset,
    validate(authSchemas.passwordReset),
    async (req, res) => {
      try {
        const { email } = req.body;
        const ipAddress = (req as any).ip || (req as any).connection?.remoteAddress;
        const userAgent = (req as any).get('User-Agent');
        logger.info('[PasswordReset] request received', { email, ipAddress, hasUserAgent: !!userAgent });

        const result = await PasswordResetService.generateResetToken(
          email,
          ipAddress,
          userAgent
        );
        logger.debug('[PasswordReset] token generation result', { email, resultExists: !!result });

        // Always return success to prevent email enumeration
        const responsePayload = {
          message: 'If the email exists, a password reset link has been sent',
          expiresIn: result ? result.expiresAt.toISOString() : null,
        };
        logger.info('[PasswordReset] response sent', responsePayload);
        res.json(responsePayload);

        // TODO: Send email with reset link
        // if (result) {
        //   await EmailService.sendPasswordResetEmail(email, result.token);
        // }
      } catch (error) {
        logger.error({ err: error, email: req.body.email, operation: 'passwordResetRequest' }, 'Password reset request error');
        res.status(500).json({
          error: 'internal_error',
          message: 'Password reset request failed',
        });
      }
    }
  );

  // POST /auth/password-reset/confirm
  r.post('/confirm',
    authRateLimits.passwordReset,
    validate(authSchemas.passwordResetConfirm),
    async (req, res) => {
      try {
        const { token, password } = req.body;
        const ipAddress = (req as any).ip || (req as any).connection?.remoteAddress;
        const userAgent = (req as any).get('User-Agent');
        logger.info('[PasswordReset] confirm invoked', { tokenPresent: !!token, ipAddress, hasUserAgent: !!userAgent });

        const success = await PasswordResetService.verifyAndConsumeToken(
          token,
          password,
          ipAddress,
          userAgent
        );
        logger.debug('[PasswordReset] verify result', { success });

        if (!success) {
          await auditService.logAuthEvent('password_reset_confirm', {
            ipAddress,
            userAgent,
            success: false,
            errorMessage: 'Invalid or expired token',
          });

          return res.status(400).json({
            error: 'invalid_token',
            message: 'Invalid or expired password reset token',
          });
        }

        const responsePayload = {
          message: 'Password has been reset successfully. Please log in with your new password.',
        };
        logger.info('[PasswordReset] confirm success response sent', responsePayload);
        res.json(responsePayload);
      } catch (error) {
        logger.error({ err: error, operation: 'passwordResetConfirm' }, 'Password reset confirm error');
        res.status(500).json({
          error: 'internal_error',
          message: 'Password reset failed',
        });
      }
    }
  );

  return r;
}
