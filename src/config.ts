import path from 'path';

const parseCorsOrigins = (): string[] => {
  const raw = process.env.CORS_ORIGIN;
  if (raw && raw.trim() !== '') {
    return raw
      .split(',')
      .map(origin => origin.trim())
      .filter(origin => origin.length > 0);
  }

  const fallbacks = new Set<string>();

  const renderExternalUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderExternalUrl && renderExternalUrl.trim() !== '') {
    fallbacks.add(renderExternalUrl.trim());
  }

  const renderExternalHostname = process.env.RENDER_EXTERNAL_HOSTNAME;
  if (renderExternalHostname && renderExternalHostname.trim() !== '') {
    const host = renderExternalHostname.trim();
    fallbacks.add(`https://${host}`);
    fallbacks.add(`http://${host}`);
  }

  if (fallbacks.size > 0) {
    return Array.from(fallbacks);
  }

  return ['*'];
};

const deleteLogsDir = process.env.DELETE_ACCOUNT_LOG_DIR || path.join(process.cwd(), 'logs');

export const config = {
  port: Number(process.env.PORT || 4000),
  corsOrigin: parseCorsOrigins(),
  jwt: {
    iss: process.env.JWT_ISS || 'chatgbtmini',
    aud: process.env.JWT_AUD || 'chatgbtmini-mobile',
    hsSecret: process.env.JWT_HS_SECRET || 'change_me_in_production',
    accessTtlMin: Number(process.env.JWT_ACCESS_TTL_MIN || 120), // 2 saat (120 dakika)
  },
  refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS || 60), // 1 ay (30 gün)
  redis: {
    url: process.env.REDIS_URL || 'redis://red-d2nf9m7diees73cjdo40:6379',
    password: process.env.REDIS_PASSWORD || '',
    host: process.env.REDIS_HOST || 'red-d2nf9m7diees73cjdo40',
    port: Number(process.env.REDIS_PORT || 6379),
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'https://google-auth-e4er.onrender.com/auth/google/callback',
  },
  app: {
    redirectUri: process.env.APP_REDIRECT_URI || 'avenia://auth',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
  },
  apple: {
    clientId: process.env.APPLE_CLIENT_ID || '',
    teamId: process.env.APPLE_TEAM_ID || '',
    keyId: process.env.APPLE_KEY_ID || '',
    privateKey: process.env.APPLE_PRIVATE_KEY || '',
    redirectUri: process.env.APPLE_REDIRECT_URI || 'https://google-auth-e4er.onrender.com/auth/apple/callback',
  },
  security: {
    maxFailedAttempts: Number(process.env.MAX_FAILED_ATTEMPTS || 5),
    lockoutDurationMinutes: Number(process.env.LOCKOUT_DURATION_MINUTES || 30),
    passwordResetTokenTtlHours: Number(process.env.PASSWORD_RESET_TTL_HOURS || 1),
  },
  api: {
    baseUrl: process.env.API_BASE_URL || 'https://google-auth-e4er.onrender.com',
    pdfRead: {
      baseUrl: process.env.PDFREAD_BASE_URL || 'https://google-auth-e4er.onrender.com',
      fallbackBaseUrl: process.env.PDFREAD_FALLBACK_BASE_URL || '',
      apiKey: process.env.PDFREAD_API_KEY || '',
      enableInternalFallback: (process.env.PDFREAD_ENABLE_INTERNAL_FALLBACK || 'false') === 'true',
    },
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY || '',
      fineTunedModelId: process.env.FINE_TUNED_MODEL_ID || 'gpt-3.5-turbo',
      assistantId: process.env.ASSISTANT_ID || '',
    },
    tts: {
      baseUrl: process.env.TTS_BASE_URL || 'https://google-auth-e4er.onrender.com',
    },
  },
  revenueCat: {
    apiKey: process.env.REVENUECAT_API_KEY || '',
    baseUrl: process.env.REVENUECAT_BASE_URL || 'https://api.revenuecat.com',
    timeoutMs: Number(process.env.REVENUECAT_TIMEOUT_MS || 10000),
    environment: process.env.REVENUECAT_ENVIRONMENT || 'production',
    enforceRealMode: process.env.REVENUECAT_ENFORCE_REAL === 'true',
  },
  deleteAccount: {
    restoreWindowDays: Number(process.env.DELETE_RESTORE_DAYS || 30),
    jobTimeoutMs: Number(process.env.DELETE_JOB_TIMEOUT_MS || 120000),
    rateLimitWindowSeconds: Number(process.env.DELETE_RATE_WINDOW_SECONDS || 600),
    rateLimitMaxRequests: Number(process.env.DELETE_RATE_MAX_REQUESTS || 2),
    telemetryEnabled: process.env.DELETE_TELEMETRY_ENABLED !== 'false',
    completionEmailDelayMs: Number(process.env.DELETE_COMPLETION_EMAIL_DELAY_MS || 5 * 60 * 1000),
    dataExportEnabled: (() => {
      const envValue = process.env.DELETE_DATA_EXPORT_ENABLED;
      // Default: enabled (true) if not set
      if (envValue === undefined || envValue === '') return true;
      // Explicitly check for 'false' string
      if (envValue.toLowerCase() === 'false') return false;
      // Everything else (including 'true', '1', 'yes') enables it
      return true;
    })(),
    logDirectory: deleteLogsDir,
    backupRetentionDays: Number(process.env.DELETE_BACKUP_RETENTION_DAYS || 365),
  },
  dataExport: {
    maxChats: Number(process.env.DATA_EXPORT_MAX_CHATS || 500),
    maxMessagesPerChat: Number(process.env.DATA_EXPORT_MAX_MESSAGES || 1000),
    maxSessions: Number(process.env.DATA_EXPORT_MAX_SESSIONS || 50),
  },
  thirdParty: {
    crmEndpoint: process.env.CRM_WEBHOOK_URL || '',
    analyticsEndpoint: process.env.ANALYTICS_WEBHOOK_URL || '',
    supportEndpoint: process.env.SUPPORT_WEBHOOK_URL || '',
  },
  notification: {
    supportEmail: process.env.SUPPORT_EMAIL || 'support@aveniaichat.com',
    suppressInTest: process.env.NOTIFICATION_SUPPRESS === 'true' || process.env.NODE_ENV === 'test',
    restoreWindowDays: Number(process.env.DELETE_RESTORE_DAYS || 30),
  },
};



