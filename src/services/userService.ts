import { admin, db } from '../firebase';
import { HashService } from './hashService';
import { User, RegisterRequest } from '../types/auth';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export class UserService {
  /**
   * Create a new user
   */
  static async createUser(request: RegisterRequest): Promise<User> {
    const userId = uuidv4();
    const passwordHash = request.password ? await HashService.hashPassword(request.password) : '';
    const now = new Date();
    const email = request.email.toLowerCase().trim();

    // Mock Firebase Authentication
    logger.info(`Mock UserService: Creating user ${email}`);
    
    const user: Omit<User, 'id'> = {
      email: email,
      passwordHash,
      name: request.name,
      provider: 'password',
      isEmailVerified: false,
      createdAt: now,
      updatedAt: now,
      failedLoginAttempts: 0,
    };

    await db.collection('subsc').doc(userId).set(user);

    try {
      await admin.auth().createUser({
        uid: userId,
        email,
        displayName: request.name,
        emailVerified: false,
      });
    } catch (error) {
      logger.warn({ error, userId, email, operation: 'createUser' }, 'Failed to sync user with Firebase Auth');
    }
    // Mock Firestore save
    logger.info('Mock UserService: Saving user to Firestore');

    return {
      id: userId,
      ...user,
    };
  }

  /**
   * Create a Google user (without password)
   */
  static async createGoogleUser(email: string, name?: string): Promise<User> {
    let userId = uuidv4();
    const now = new Date();
    const normalizedEmail = email.toLowerCase().trim();

    let existingAuthUser: any = null;
    try {
      existingAuthUser = await admin.auth().getUserByEmail(normalizedEmail);
      if (existingAuthUser?.uid) {
        userId = existingAuthUser.uid;
      }
    } catch (error: any) {
      if (error?.code !== 'auth/user-not-found') {
        logger.warn({ error, email: normalizedEmail, operation: 'lookupGoogleAuthUser' }, 'Failed to lookup Firebase Auth user by email');
      }
    }


    logger.info(`Creating Google user: ${normalizedEmail}`, { operation: 'createGoogleUser' });
    
    const user: Omit<User, 'id'> = {
      email: normalizedEmail,
      passwordHash: '', // Google users don't have passwords
      name: name || '',
      provider: 'google',
      isEmailVerified: true, // Google users are pre-verified
      createdAt: now,
      updatedAt: now,
      failedLoginAttempts: 0,
      lastLoginAt: now,
    };

    // 1. Save to subsc collection (Firestore)
    try {
      await db.collection('subsc').doc(userId).set({
        ...user,
        id: userId, // Include ID in document
        provider: 'google', // Add provider info
        googleId: existingAuthUser?.uid || null, // Add Google ID if exists
      });
      logger.info('User saved to subsc collection', { userId, email: normalizedEmail });
    } catch (error) {
      logger.error('Failed to save user to subsc collection', { error, userId, email: normalizedEmail });
      throw new Error('Failed to save user to database');
    }

    // 2. Create/Update Firebase Auth user
    try {
      if (existingAuthUser) {
        // Update existing Firebase Auth user
        logger.info('Updating existing Firebase Auth user', { userId, email: normalizedEmail });
        await admin.auth().updateUser(userId, {
          email: normalizedEmail,
          displayName: name,
          emailVerified: true,
        });
        logger.info('Firebase Auth user updated successfully', { userId, email: normalizedEmail });
      } else {
        // Create new Firebase Auth user
        logger.info('Creating new Firebase Auth user', { userId, email: normalizedEmail });
        const firebaseUser = await admin.auth().createUser({
          uid: userId,
          email: normalizedEmail,
          displayName: name,
          emailVerified: true,
        });
        logger.info('Firebase Auth user created successfully', { 
          userId, 
          email: normalizedEmail,
          firebaseUid: firebaseUser.uid 
        });
      }
    } catch (error) {
      logger.error('Firebase Auth sync error', { 
        error: error instanceof Error ? error.message : String(error), 
        errorCode: (error as any)?.code || 'UNKNOWN',
        userId, 
        email: normalizedEmail,
        stack: error instanceof Error ? error.stack : undefined
      });
      // Don't throw error here, user is already saved to subsc
    }

    return {
      id: userId,
      ...user,
    };
  }

  /**
   * Create a new Apple user
   */
  static async createAppleUser(email: string, name?: string): Promise<User> {
    const userId = uuidv4();
    const now = new Date();
    const normalizedEmail = email.toLowerCase().trim();


    // Mock Firebase Authentication
    logger.info(`Mock UserService: Creating Apple user ${normalizedEmail}`);
    
    const user: Omit<User, 'id'> = {
      email: normalizedEmail,
      passwordHash: '', // Apple users don't have passwords
      name: name || '',
      provider: 'apple',
      isEmailVerified: true, // Apple users are pre-verified
      createdAt: now,
      updatedAt: now,
      failedLoginAttempts: 0,
    };

    await db.collection('subsc').doc(userId).set(user);

    try {
      await admin.auth().createUser({
        uid: userId,
        email: normalizedEmail,
        displayName: name,
        emailVerified: true,
      });
    } catch (error) {
      logger.warn({ error, email: normalizedEmail, operation: 'createAppleUser' }, 'Failed to sync Apple user with Firebase Auth');
    }

    // Mock Firestore save
    logger.info('Mock UserService: Saving Apple user to Firestore');

    return {
      id: userId,
      ...user,
    };
  }

  /**
   * Find user by email
   */
  static async findByEmail(email: string): Promise<User | null> {
    const normalizedEmail = email.toLowerCase().trim();
    const snapshot = await db
      .collection('subsc')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    return {
      id: doc.id,
      ...doc.data(),
    } as any as User;
  }

  /**
   * Find user by ID
   */
  static async findById(userId: string): Promise<User | null> {
    const doc = await db.collection('subsc').doc(userId).get();
    if (!doc.exists) {
      return null;
    }

    const data = doc.data();
    if (!data) {
      return null;
    }


    // Mock user data for testing
    logger.info(`Mock UserService: Finding user by ID ${userId}`);
    
    // Return a mock user for testing
    return {
      id: doc.id,
      ...data,
    } as User;
  }

  /**
   * Verify user password
   */
  static async verifyPassword(user: User, password: string): Promise<boolean> {
    return HashService.verifyPassword(password, user.passwordHash);
  }

  /**
   * Check if user is locked due to failed attempts
   */
  static isUserLocked(user: User): boolean {
    if (!user.lockedUntil) {
      return false;
    }
    return user.lockedUntil > new Date();
  }

  /**
   * Increment failed login attempts
   */
  static async incrementFailedAttempts(userId: string): Promise<void> {
    const userRef = db.collection('subsc').doc(userId);
    const user = await this.findById(userId);
    
    if (!user) return;

    const failedAttempts = user.failedLoginAttempts + 1;
    const updateData: Partial<User> = {
      failedLoginAttempts: failedAttempts,
      updatedAt: new Date(),
    };

    // Lock account after 5 failed attempts for 30 minutes
    if (failedAttempts >= 5) {
      const lockUntil = new Date();
      lockUntil.setMinutes(lockUntil.getMinutes() + 30);
      updateData.lockedUntil = lockUntil;
    }

    await userRef.update(updateData);
  }

  /**
   * Reset failed login attempts on successful login
   */
  static async resetFailedAttempts(userId: string): Promise<void> {
    await db.collection('subsc').doc(userId).update({
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Update user profile
   */
  static async updateUser(userId: string, updates: Partial<User>): Promise<void> {
    const userRef = db.collection('subsc').doc(userId);
    const existing = await userRef.get();

    if (!existing.exists || !existing.data()) {
      return;
    }

    await userRef.update({
      ...updates,
      updatedAt: new Date(),
    });

    try {
      const firebaseUpdates: any = {};
      if (updates.email) firebaseUpdates.email = updates.email;
      if (updates.name) firebaseUpdates.displayName = updates.name;
      if (Object.keys(firebaseUpdates).length > 0) {
        await admin.auth().updateUser(userId, firebaseUpdates);
      }
    } catch (error) {
      logger.warn({ error, userId, operation: 'updateUser' }, 'Failed to update Firebase Auth user');
    }

    // Mock Firestore update
    logger.info(`Mock UserService: Updating user ${userId}`, updates);
  }

  /**
   * Update user password
   */
  static async updatePassword(userId: string, newPassword: string): Promise<void> {
    if (!newPassword) {
      return;
    }
    const passwordHash = await HashService.hashPassword(newPassword);
    await db.collection('subsc').doc(userId).set(
      {
        passwordHash,
        updatedAt: new Date(),
      },
      { merge: true }
    );
    logger.info({ userId }, 'Password hash updated in subsc collection');
    try {
      await admin.auth().updateUser(userId, { password: newPassword });
      logger.info({ userId }, 'Firebase Auth password updated');
    } catch (error) {
      logger.warn({ error, userId, operation: 'firebasePasswordUpdate' }, 'Failed to update Firebase Auth password');
    }
  }

  /**
   * Check if email is already registered
   */
  static async isEmailRegistered(email: string): Promise<boolean> {
    const user = await this.findByEmail(email);
    return user !== null;
  }
}
