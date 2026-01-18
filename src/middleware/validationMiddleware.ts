import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

/**
 * Validation middleware factory
 */
export const validate = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'validation_error',
          message: 'Invalid request data',
          details: error.issues.map((err: any) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
        return;
      }
      
      res.status(400).json({
        error: 'validation_error',
        message: 'Invalid request data',
      });
    }
  };
};

/**
 * Validation schemas for auth endpoints
 */
export const authSchemas = {
  register: z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(8, 'Password must be at least 8 characters')
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one lowercase letter, one uppercase letter, and one number'),
    device: z.object({
      os: z.string().optional(),
      model: z.string().optional(),
      appVersion: z.string().optional(),
      platform: z.string().optional(),
    }),
    deviceId: z.string().optional(),
    name: z.string().min(1, 'Name is required').max(100, 'Name too long').optional(),
  }),

  login: z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(1, 'Password is required'),
    device: z.object({
      os: z.string().optional(),
      model: z.string().optional(),
      appVersion: z.string().optional(),
      platform: z.string().optional(),
    }),
    deviceId: z.string().optional(),
  }),

  refresh: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
    sessionId: z.string().uuid('Invalid session ID format'),
    deviceId: z.string().optional(),
  }),

  logout: z.object({
    sessionId: z.string().uuid('Invalid session ID format'),
  }),

  passwordReset: z.object({
    email: z.string().email('Invalid email format'),
  }),

  passwordResetConfirm: z.object({
    token: z.string().min(1, 'Reset token is required'),
    password: z.string().min(8, 'Password must be at least 8 characters')
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one lowercase letter, one uppercase letter, and one number'),
  }),

  // 2FA schemas (for future implementation)
  enable2FA: z.object({
    method: z.enum(['totp', 'sms']),
    phoneNumber: z.string().optional(),
  }),

  verify2FA: z.object({
    code: z.string().min(6, '2FA code must be at least 6 characters'),
    backupCode: z.string().optional(),
  }),
};

/**
 * Validation schemas for chat endpoints
 */
export const chatSchemas = {
  sendMessage: z.object({
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string().min(1, 'Message content is required'),
      timestamp: z.any().optional(),
      fileName: z.string().optional(),
      fileUrl: z.string().optional(),
    })).min(1, 'At least one message is required'),
    chatId: z.string().min(1, 'Chat ID is required'),
    hasImage: z.boolean().optional().default(false),
    imageFileUrl: z.string().optional(),
  }),
  
  textToSpeech: z.object({
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string().min(1, 'Message content is required'),
      timestamp: z.any().optional(),
      fileName: z.string().optional(),
      fileUrl: z.string().optional(),
    })).min(1, 'At least one message is required'),
  }),
  
  createChat: z.object({
    title: z.string().optional(),
  }),
};

const deleteReasonEnum = z.enum(['security', 'dissatisfied', 'not_using', 'switching_service', 'other']);
const deleteReasonSchema = z.union([deleteReasonEnum, z.literal('user_request')]);
const deviceInfoSchema = z.object({
  os: z.string().optional(),
  model: z.string().optional(),
  appVersion: z.string().optional(),
  platform: z.string().optional(),
}).partial();

export const deleteAccountSchemas = {
  initiate: z.object({
    deleteReason: deleteReasonSchema.optional(),
    deleteReasonNote: z.string().max(1000, 'Açıklama en fazla 1000 karakter olabilir').optional(),
    confirmPermanentDeletion: z.boolean().refine(value => value === true, {
      message: 'Kalıcı silme onayı verilmelidir',
    }),
    gdprAcknowledged: z.boolean().refine(value => value === true, {
      message: 'GDPR/KVKK bilgilendirmesi onaylanmalıdır',
    }),
    skipDataExport: z.boolean().optional(),
    initiatedFrom: z.string().max(50).optional(),
    appVersion: z.string().max(50).optional(),
    locale: z.string().max(10).optional(),
    deviceInfo: deviceInfoSchema.optional(),
    platform: z.string().max(50).optional(),
    anonymous: z.boolean().optional(),
  }),
  dataExport: z.object({
    forceRegenerate: z.boolean().optional(),
  }),
  restore: z.object({
    confirmationCode: z.string().min(4).max(12).optional(),
    reason: z.string().max(500).optional(),
  }),
  jobParams: z.object({
    jobId: z.string().min(10, 'Geçerli bir jobId gereklidir'),
  }),
};

export const premiumSchemas = {
  customerInfo: z.object({
    customerInfo: z.any(),
    platform: z.string().max(50).optional(),
    source: z.string().max(100).optional(),
    requestId: z.string().max(100).optional(),
  }),
  restore: z.object({
    appUserId: z.string().max(200).optional(),
    requestId: z.string().max(100).optional(),
    source: z.string().max(100).optional(),
    platform: z.string().max(50).optional(),
    currentUid: z.string().max(200).optional(),
    email: z.string().email('Geçerli bir e-posta giriniz').optional(),
    oldAppUserId: z.string().max(200).optional(),
  }),
};

/**
 * Query parameter validation
 */
export const validateQuery = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'validation_error',
          message: 'Invalid query parameters',
          details: error.issues.map((err: any) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
        return;
      }
      
      res.status(400).json({
        error: 'validation_error',
        message: 'Invalid query parameters',
      });
    }
  };
};

/**
 * Params validation
 */
export const validateParams = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      schema.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'validation_error',
          message: 'Invalid URL parameters',
          details: error.issues.map((err: any) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
        return;
      }
      
      res.status(400).json({
        error: 'validation_error',
        message: 'Invalid URL parameters',
      });
    }
  };
};
