import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// User schemas
export const userSchemas = {
  create: Joi.object({
    email: Joi.string().email().required().messages({
      'string.email': 'Geçerli bir e-posta adresi giriniz',
      'any.required': 'E-posta adresi zorunludur',
    }),
    password: Joi.string().min(8).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/).required().messages({
      'string.min': 'Şifre en az 8 karakter olmalıdır',
      'string.pattern.base': 'Şifre en az bir küçük harf, bir büyük harf, bir rakam ve bir özel karakter içermelidir',
      'any.required': 'Şifre zorunludur',
    }),
    name: Joi.string().min(2).max(50).optional().messages({
      'string.min': 'İsim en az 2 karakter olmalıdır',
      'string.max': 'İsim en fazla 50 karakter olabilir',
    }),
    terms_accepted: Joi.boolean().valid(true).required().messages({
      'any.only': 'Kullanım şartlarını kabul etmelisiniz',
      'any.required': 'Kullanım şartları kabulü zorunludur',
    }),
  }),

  update: Joi.object({
    name: Joi.string().min(2).max(50).optional(),
    email: Joi.string().email().optional(),
    preferences: Joi.object({
      language: Joi.string().valid('tr', 'en', 'es', 'fr', 'pt', 'ru').optional(),
      theme: Joi.string().valid('light', 'dark', 'system').optional(),
      notifications: Joi.boolean().optional(),
    }).optional(),
  }),

  login: Joi.object({
    email: Joi.string().email().required().messages({
      'string.email': 'Geçerli bir e-posta adresi giriniz',
      'any.required': 'E-posta adresi zorunludur',
    }),
    password: Joi.string().required().messages({
      'any.required': 'Şifre zorunludur',
    }),
  }),
};

// Chat schemas
export const chatSchemas = {
  create: Joi.object({
    title: Joi.string().min(1).max(100).optional().messages({
      'string.min': 'Başlık en az 1 karakter olmalıdır',
      'string.max': 'Başlık en fazla 100 karakter olabilir',
    }),
    user_id: Joi.string().uuid().required().messages({
      'string.guid': 'Geçerli bir kullanıcı ID giriniz',
      'any.required': 'Kullanıcı ID zorunludur',
    }),
    is_favorite: Joi.boolean().optional(),
    tags: Joi.array().items(Joi.string().max(20)).max(10).optional().messages({
      'array.max': 'En fazla 10 etiket ekleyebilirsiniz',
      'string.max': 'Etiket en fazla 20 karakter olabilir',
    }),
  }),

  update: Joi.object({
    title: Joi.string().min(1).max(100).optional(),
    is_favorite: Joi.boolean().optional(),
    tags: Joi.array().items(Joi.string().max(20)).max(10).optional(),
  }),

  message: Joi.object({
    content: Joi.string().min(1).max(10000).required().messages({
      'string.min': 'Mesaj içeriği zorunludur',
      'string.max': 'Mesaj en fazla 10000 karakter olabilir',
      'any.required': 'Mesaj içeriği zorunludur',
    }),
    role: Joi.string().valid('user', 'assistant', 'system').required().messages({
      'any.only': 'Geçerli bir rol seçiniz',
      'any.required': 'Rol zorunludur',
    }),
    chat_id: Joi.string().uuid().required().messages({
      'string.guid': 'Geçerli bir chat ID giriniz',
      'any.required': 'Chat ID zorunludur',
    }),
    attachments: Joi.array().items(
      Joi.object({
        type: Joi.string().valid('image', 'document', 'audio', 'video').required(),
        url: Joi.string().uri().required(),
        name: Joi.string().max(100).optional(),
        size: Joi.number().positive().max(50 * 1024 * 1024).optional(), // 50MB max
      })
    ).max(5).optional().messages({
      'array.max': 'En fazla 5 dosya ekleyebilirsiniz',
    }),
  }),
};

// Authentication schemas
export const authSchemas = {
  emailVerification: Joi.object({
    email: Joi.string().email().required().messages({
      'string.email': 'Geçerli bir e-posta adresi giriniz',
      'any.required': 'E-posta adresi zorunludur',
    }),
  }),

  verifyCode: Joi.object({
    email: Joi.string().email().required(),
    code: Joi.string().length(6).pattern(/^\d+$/).required().messages({
      'string.length': 'Kod 6 haneli olmalıdır',
      'string.pattern.base': 'Kod sadece rakamlardan oluşmalıdır',
      'any.required': 'Kod zorunludur',
    }),
  }),

  passwordReset: Joi.object({
    email: Joi.string().email().required().messages({
      'string.email': 'Geçerli bir e-posta adresi giriniz',
      'any.required': 'E-posta adresi zorunludur',
    }),
  }),

  resetPassword: Joi.object({
    token: Joi.string().required().messages({
      'any.required': 'Token zorunludur',
    }),
    password: Joi.string().min(8).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/).required().messages({
      'string.min': 'Şifre en az 8 karakter olmalıdır',
      'string.pattern.base': 'Şifre en az bir küçük harf, bir büyük harf, bir rakam ve bir özel karakter içermelidir',
      'any.required': 'Şifre zorunludur',
    }),
    confirmPassword: Joi.string().valid(Joi.ref('password')).required().messages({
      'any.only': 'Şifreler eşleşmiyor',
      'any.required': 'Şifre onayı zorunludur',
    }),
  }),
};

// File upload schemas
export const fileSchemas = {
  upload: Joi.object({
    type: Joi.string().valid('image', 'document', 'audio', 'video').required().messages({
      'any.only': 'Geçerli bir dosya türü seçiniz',
      'any.required': 'Dosya türü zorunludur',
    }),
    size: Joi.number().positive().max(50 * 1024 * 1024).required().messages({
      'number.max': 'Dosya boyutu 50MB\'dan küçük olmalıdır',
      'any.required': 'Dosya boyutu zorunludur',
    }),
    name: Joi.string().min(1).max(100).required().messages({
      'string.min': 'Dosya adı zorunludur',
      'string.max': 'Dosya adı en fazla 100 karakter olabilir',
      'any.required': 'Dosya adı zorunludur',
    }),
  }),

  image: Joi.object({
    width: Joi.number().positive().max(4000).optional(),
    height: Joi.number().positive().max(4000).optional(),
    format: Joi.string().valid('jpeg', 'jpg', 'png', 'gif', 'webp').optional(),
  }),

  document: Joi.object({
    format: Joi.string().valid('pdf', 'doc', 'docx', 'txt', 'rtf').required(),
    pages: Joi.number().positive().max(1000).optional(),
  }),
};

// API request schemas
export const apiSchemas = {
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1).messages({
      'number.min': 'Sayfa numarası 1\'den küçük olamaz',
    }),
    limit: Joi.number().integer().min(1).max(100).default(20).messages({
      'number.min': 'Limit 1\'den küçük olamaz',
      'number.max': 'Limit 100\'den büyük olamaz',
    }),
    sort: Joi.string().valid('asc', 'desc').default('desc').messages({
      'any.only': 'Sıralama sadece asc veya desc olabilir',
    }),
    sortBy: Joi.string().max(50).optional(),
  }),

  search: Joi.object({
    query: Joi.string().min(1).max(100).required().messages({
      'string.min': 'Arama terimi zorunludur',
      'string.max': 'Arama terimi en fazla 100 karakter olabilir',
      'any.required': 'Arama terimi zorunludur',
    }),
    filters: Joi.object().optional(),
    dateFrom: Joi.date().iso().optional().messages({
      'date.format': 'Geçerli bir tarih formatı giriniz (ISO 8601)',
    }),
    dateTo: Joi.date().iso().min(Joi.ref('dateFrom')).optional().messages({
      'date.format': 'Geçerli bir tarih formatı giriniz (ISO 8601)',
      'date.min': 'Bitiş tarihi başlangıç tarihinden sonra olmalıdır',
    }),
  }),
};

// Settings schemas
export const settingsSchemas = {
  update: Joi.object({
    language: Joi.string().valid('tr', 'en', 'es', 'fr', 'pt', 'ru').optional(),
    theme: Joi.string().valid('light', 'dark', 'system').optional(),
    notifications: Joi.object({
      email: Joi.boolean().optional(),
      push: Joi.boolean().optional(),
      marketing: Joi.boolean().optional(),
    }).optional(),
    privacy: Joi.object({
      profile_visibility: Joi.string().valid('public', 'private', 'friends').optional(),
      data_sharing: Joi.boolean().optional(),
    }).optional(),
  }),
};

// Validation middleware
export const validateRequest = (schema: Joi.ObjectSchema, property: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction) => {
    const data = req[property];
    
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const errorDetails = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value,
      }));

      logger.warn('Validation error', {
        property,
        errors: errorDetails,
        data,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      });

      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz veri',
          details: errorDetails,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Replace the original data with validated and sanitized data
    req[property] = value;
    next();
  };
};

// Custom validation functions
export const validateEmail = (email: string): boolean => {
  const emailSchema = Joi.string().email();
  const { error } = emailSchema.validate(email);
  return !error;
};

export const validatePassword = (password: string): { valid: boolean; errors: string[] } => {
  const passwordSchema = Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/);
  
  const { error } = passwordSchema.validate(password);
  
  if (error) {
    return {
      valid: false,
      errors: error.details.map(detail => detail.message),
    };
  }
  
  return { valid: true, errors: [] };
};

export const validateUUID = (uuid: string): boolean => {
  const uuidSchema = Joi.string().uuid();
  const { error } = uuidSchema.validate(uuid);
  return !error;
};

export const validateFileType = (filename: string, allowedTypes: string[]): boolean => {
  const extension = filename.split('.').pop()?.toLowerCase();
  return extension ? allowedTypes.includes(extension) : false;
};

export const validateFileSize = (size: number, maxSize: number): boolean => {
  return size <= maxSize;
};

// Sanitization functions
export const sanitizeString = (input: string): string => {
  return input.trim().replace(/[<>]/g, '');
};

export const sanitizeHTML = (input: string): string => {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
};

export const sanitizeObject = (obj: any): any => {
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  
  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        sanitized[key] = sanitizeObject(obj[key]);
      }
    }
    return sanitized;
  }
  
  return obj;
};

// Export all schemas
export const schemas = {
  user: userSchemas,
  chat: chatSchemas,
  auth: authSchemas,
  file: fileSchemas,
  api: apiSchemas,
  settings: settingsSchemas,
};

