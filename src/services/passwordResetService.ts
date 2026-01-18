import { db } from '../firebase';
import { HashService } from './hashService';
import { UserService } from './userService';
import { auditService } from './auditService';
import { randomBytes } from 'crypto';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';

export interface PasswordResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

export class PasswordResetService {
  /**
   * Generate a password reset token
   */
  static async generateResetToken(
    email: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ token: string; expiresAt: Date } | null> {
    const user = await UserService.findByEmail(email);
    if (!user) {
      // Don't reveal if email exists or not
      return null;
    }

    // Generate secure token
    const token = randomBytes(32).toString('base64url');
    const tokenHash = await HashService.hashRefreshToken(token);
    const tokenId = uuidv4();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + config.security.passwordResetTokenTtlHours);

    const resetToken: Omit<PasswordResetToken, 'id'> = {
      userId: user.id,
      tokenHash,
      expiresAt,
      createdAt: new Date(),
      ipAddress,
      userAgent,
    };

    await db.collection('passwordResetTokens').doc(tokenId).set(resetToken);

    // Log the reset request
    await auditService.logAuthEvent('password_reset_request', {
      userId: user.id,
      ipAddress,
      userAgent,
      success: true,
    });

    return { token, expiresAt };
  }

  /**
   * Verify and consume a password reset token
   */
  static async verifyAndConsumeToken(
    token: string,
    newPassword: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<boolean> {
    const tokenHash = await HashService.hashRefreshToken(token);
    
    // Find token by hash
    const snapshot = await db
      .collection('passwordResetTokens')
      .where('tokenHash', '==', tokenHash)
      .where('usedAt', '==', null)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return false;
    }

    const doc = snapshot.docs[0];
    const resetToken = { id: doc.id, ...doc.data() } as any as PasswordResetToken;

    // Check if token is expired
    if (resetToken.expiresAt < new Date()) {
      return false;
    }

    // Update user password
    const newPasswordHash = await HashService.hashPassword(newPassword);
    await UserService.updateUser(resetToken.userId, {
      passwordHash: newPasswordHash,
    });

    // Mark token as used
    await doc.ref.update({
      usedAt: new Date(),
    });

    // Revoke all user sessions (force re-login)
    const { SessionService } = await import('./sessionService');
    await SessionService.revokeAllUserSessions(resetToken.userId);

    // Log successful password reset
    await auditService.logAuthEvent('password_reset_success', {
      userId: resetToken.userId,
      ipAddress,
      userAgent,
      success: true,
    });

    return true;
  }

  /**
   * Clean up expired password reset tokens
   */
  static async cleanupExpiredTokens(): Promise<number> {
    const now = new Date();
    const snapshot = await db
      .collection('passwordResetTokens')
      .where('expiresAt', '<', now)
      .get();

    const batch = db.batch();
    snapshot.docs.forEach((doc: any) => {
      batch.delete(doc.ref);
    });

    if (!snapshot.empty) {
      await batch.commit();
    }

    return snapshot.size;
  }

  /**
   * Get active reset tokens for a user
   */
  static async getActiveTokensForUser(userId: string): Promise<PasswordResetToken[]> {
    const now = new Date();
    const snapshot = await db
      .collection('passwordResetTokens')
      .where('userId', '==', userId)
      .where('usedAt', '==', null)
      .where('expiresAt', '>', now)
      .get();

    return snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
    })) as any as PasswordResetToken[];
  }
}






