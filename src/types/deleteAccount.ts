import { DeviceInfo } from './auth';

export type DeleteReason =
  | 'security'
  | 'dissatisfied'
  | 'not_using'
  | 'switching_service'
  | 'other';

export interface DeleteAccountRequestBody {
  deleteReason?: DeleteReason | 'user_request';
  deleteReasonNote?: string;
  confirmPermanentDeletion: boolean;
  gdprAcknowledged: boolean;
  skipDataExport?: boolean;
  initiatedFrom?: string;
  appVersion?: string;
  locale?: string;
  deviceInfo?: DeviceInfo;
  platform?: string;
  anonymous?: boolean;
}

export interface DeleteAccountContext {
  ipAddress?: string;
  userAgent?: string;
  country?: string;
  city?: string;
}

export interface DeleteAccountResult {
  jobId: string;
  status: DeletionJobStatus;
  providersToUnlink: string[];
  restoreUntil?: string;
  message: string;
}

export type DeletionJobStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface DeletionJobPhase {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface DeletionJobRecord {
  id: string;
  userId: string;
  email?: string;
  status: DeletionJobStatus;
  reason: DeleteReason;
  reasonNote?: string;
  initiatedFrom?: string;
  restoreUntil?: string;
  createdAt: string;
  updatedAt: string;
  phases: DeletionJobPhase[];
  metrics: {
    firestoreDocsDeleted?: number;
    storageObjectsDeleted?: number;
    durationMs?: number;
  };
  context?: DeleteAccountContext;
  skipDataExport?: boolean;
  anonymous?: boolean;
}

export interface DeletedUserRegistryRecord {
  uid: string;
  email?: string;
  provider?: string;
  deletedAt: string;
  deleteReason: DeleteReason | 'user_request';
  deleteReasonNote?: string;
  canRestoreUntil?: string | null;
  restoreExpiresAt?: string | null;
  restoreWindow?: number;
  ip?: string;
  userAgent?: string;
  restoreRequestedAt?: string;
  restoreCompletedAt?: string;
  blockedForWebhook?: boolean;
  legalHold?: boolean;
  fraudSuspected?: boolean;
  jobId?: string;
  anonymous?: boolean;
  activeSubscriptionDetected?: boolean;
  oldUid?: string;
  oldAppUserId?: string;
  deleteDate?: string;
  subscriptionSource?: string;
  googlePlayPurchaseToken?: string | null;
  restoredToUid?: string;
  lastRestoreRequestId?: string;
}

export interface RestoreAccountRequestBody {
  confirmationCode?: string;
  reason?: string;
}

export interface RestoreAccountResult {
  restored: boolean;
  restoredAt?: string;
  message: string;
}

export interface PersonalDataExportResult {
  archiveBase64: string;
  fileName: string;
  size: number;
  generatedAt: string;
  expiresAt: string;
}

