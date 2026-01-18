import argon2 from 'argon2';

export class HashService {
  private static readonly ARGON2_OPTIONS = {
    type: argon2.argon2id,
    memoryCost: 2 ** 16, // 64 MB
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
  };

  /**
   * Hash a password using Argon2id
   */
  static async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, this.ARGON2_OPTIONS);
  }

  /**
   * Verify a password against its hash
   */
  static async verifyPassword(password: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch (error) {
      return false;
    }
  }

  /**
   * Hash a refresh token using Argon2id
   */
  static async hashRefreshToken(token: string): Promise<string> {
    return argon2.hash(token, {
      ...this.ARGON2_OPTIONS,
      memoryCost: 2 ** 14, // 16 MB (lighter for frequent operations)
      timeCost: 2,
    });
  }

  /**
   * Verify a refresh token against its hash
   */
  static async verifyRefreshToken(token: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, token);
    } catch (error) {
      return false;
    }
  }
}

