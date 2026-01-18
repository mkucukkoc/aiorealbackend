import { admin } from './firebase';
import { db } from './firebase';
import { logger } from './utils/logger';

/**
 * Migration script to create Firebase Authentication users for existing database users
 * This should be run once to migrate existing users to Firebase Authentication
 */
async function migrateUsersToFirebase() {
  try {
    logger.info('Starting user migration to Firebase Authentication...');
    
    // Get all users from Firestore
    const usersSnapshot = await db.collection('subsc').get();
    const users = usersSnapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data()
    })) as any[];

    logger.info(`Found ${users.length} users to migrate`);

    let successCount = 0;
    let errorCount = 0;

    for (const user of users) {
      try {
        // Check if user already exists in Firebase Authentication
        try {
          await admin.auth().getUser(user.id);
          logger.warn(`User ${user.id} already exists in Firebase Authentication, skipping...`);
          continue;
        } catch (error) {
          // User doesn't exist, create it
        }

        // Create user in Firebase Authentication
        const firebaseUser = await admin.auth().createUser({
          uid: user.id,
          email: user.email,
          displayName: user.name || '',
          emailVerified: user.isEmailVerified || false,
          // Don't set password for existing users, they'll use the existing auth system
        });

        logger.info(`Successfully created Firebase user: ${firebaseUser.uid} (${firebaseUser.email})`);
        successCount++;

      } catch (error) {
        logger.error(`Failed to create Firebase user for ${user.id}:`, error);
        errorCount++;
      }
    }

    logger.info(`Migration completed. Success: ${successCount}, Errors: ${errorCount}`);

  } catch (error) {
    logger.error('Migration failed:', error);
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrateUsersToFirebase()
    .then(() => {
      logger.info('Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Migration script failed:', error);
      process.exit(1);
    });
}

export { migrateUsersToFirebase };
