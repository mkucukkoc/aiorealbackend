import { admin, db } from '../firebase';
import { logger } from '../utils/logger';

export async function restoreSoftDeletedUser(userId: string) {
  try {
    const nowIso = new Date().toISOString();

    await db
      .collection('subsc')
      .doc(userId)
      .set(
        {
          isDeleted: false,
          is_deleted: false,
          deletedAt: null,
          premiumCancelledAt: null,
          restoredAt: nowIso,
        },
        { merge: true }
      );
    logger.info({ userId }, 'subsc document cleared from soft-delete state during reactivation');

    try {
      const blacklistRef = db.collection('notification_blacklist').doc(userId);
      const blacklistDoc = await blacklistRef.get();
      if (blacklistDoc.exists) {
        await blacklistRef.delete();
        logger.info({ userId }, 'notification_blacklist entry removed during reactivation');
      } else {
        logger.debug({ userId }, 'No notification_blacklist entry found during reactivation');
      }
    } catch (blacklistError: unknown) {
      logger.warn({ blacklistError, userId }, 'Failed to remove notification blacklist entry during reactivation');
    }
  } catch (error: unknown) {
    logger.warn({ error, userId }, 'Failed to clear soft delete flags during reactivation');
  }
}

export async function cleanupDeletedAccountArtifacts(userId: string) {
  logger.info({ userId }, 'Cleaning up deleted account artifacts');
  const cleanupJobs = [
    deleteDocumentIfExists('deleted_users_subsc', userId, 'deleted_users_subsc record'),
    deleteDocumentIfExists('notification_blacklist', userId, 'notification blacklist record'),
    deleteDeletionJobsForUser(userId),
    deleteTelemetryEventsForUser(userId),
  ];

  await Promise.all(cleanupJobs);
  logger.info({ userId }, 'Deleted account artifacts cleanup finished');
}

export async function ensureFirebaseAuthUserProfile(userId: string, profile: { email?: string; name?: string }) {
  try {
    const existing = await admin.auth().getUser(userId);
    const updates: Record<string, unknown> = {};
    if (profile.email && existing.email !== profile.email) {
      updates.email = profile.email;
      updates.emailVerified = true;
    }
    if (profile.name && existing.displayName !== profile.name) {
      updates.displayName = profile.name;
    }
    if (Object.keys(updates).length > 0) {
      await admin.auth().updateUser(userId, updates);
      logger.info({ userId }, 'Firebase Auth user profile updated during reactivation');
    }
  } catch (error: any) {
    if (error?.code === 'auth/user-not-found') {
      if (!profile.email) {
        logger.warn({ userId }, 'Cannot recreate Firebase Auth user without email');
        return;
      }
      await admin.auth().createUser({
        uid: userId,
        email: profile.email,
        displayName: profile.name,
        emailVerified: true,
      });
      logger.info({ userId }, 'Firebase Auth user recreated during reactivation');
      return;
    }
    logger.warn({ error, userId }, 'Failed to ensure Firebase Auth user profile');
  }
}

async function deleteDocumentIfExists(collection: string, docId: string, logLabel: string) {
  try {
    const ref = db.collection(collection).doc(docId);
    const doc = await ref.get();
    if (!doc.exists) {
      logger.debug({ docId, collection }, `No ${logLabel} found during restore`);
      return;
    }
    await ref.delete();
    logger.info({ docId, collection }, `${logLabel} deleted during restore`);
  } catch (error: unknown) {
    logger.warn({ error, docId, collection }, `Failed to delete ${logLabel} during restore`);
  }
}

async function deleteDeletionJobsForUser(userId: string) {
  try {
    const snapshot = await db
      .collection('deletion_jobs')
      .where('userId', '==', userId)
      .limit(100)
      .get();

    if (snapshot.empty) {
      logger.debug({ userId }, 'No deletion jobs found for cleanup');
      return;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc: any) => batch.delete(doc.ref));
    await batch.commit();
    logger.info({ userId, deletedJobs: snapshot.size }, 'Deletion job records cleaned up for user restore');

    if (snapshot.size === 100) {
      await deleteDeletionJobsForUser(userId);
    }
  } catch (error: unknown) {
    logger.warn({ error, userId }, 'Failed to cleanup deletion job records during user restore');
  }
}

async function deleteTelemetryEventsForUser(userId: string) {
  try {
    const snapshot = await db
      .collection('telemetry_events')
      .where('userId', '==', userId)
      .where('event', '==', 'DELETE_ACCOUNT')
      .limit(100)
      .get();

    if (snapshot.empty) {
      logger.debug({ userId }, 'No telemetry events found for cleanup');
      return;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc: any) => batch.delete(doc.ref));
    await batch.commit();
    logger.info({ userId, deletedEvents: snapshot.size }, 'Telemetry events cleaned up for user restore');

    if (snapshot.size === 100) {
      await deleteTelemetryEventsForUser(userId);
    }
  } catch (error: unknown) {
    logger.warn({ error, userId }, 'Failed to cleanup telemetry events during user restore');
  }
}

