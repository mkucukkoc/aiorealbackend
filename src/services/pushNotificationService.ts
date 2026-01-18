import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { admin } from '../firebase';
import { logger } from '../utils/logger';
import { databaseManager } from '../config/database';

export interface PushNotificationData {
  to: string | string[];
  title: string;
  body: string;
  data?: any;
  sound?: string;
  badge?: number;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
  category?: string;
}

export interface UserPushToken {
  id?: string;
  userId: string;
  expoPushToken: string;
  deviceId: string;
  platform: 'ios' | 'android' | 'web';
  isActive: boolean;
  lastUsed?: Date;
  createdAt: Date;
}

class PushNotificationService {
  private static instance: PushNotificationService;
  private expo: Expo;
  private isInitialized = false;

  private constructor() {
    this.expo = new Expo({
      accessToken: process.env.EXPO_ACCESS_TOKEN,
      useFcmV1: true,
    });
  }

  public static getInstance(): PushNotificationService {
    if (!PushNotificationService.instance) {
      PushNotificationService.instance = new PushNotificationService();
    }
    return PushNotificationService.instance;
  }

  // Initialize the service
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.info('PushNotificationService already initialized');
      return;
    }

    try {
      // Test Expo connection
      await this.testExpoConnection();
      
      this.isInitialized = true;
      logger.info('PushNotificationService initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize PushNotificationService:', error);
      throw error;
    }
  }

  // Test Expo connection
  private async testExpoConnection(): Promise<void> {
    try {
      // Simple test to verify Expo SDK is working
      const testMessage: ExpoPushMessage = {
        to: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', // Invalid token for testing
        title: 'Test',
        body: 'Test message',
      };

      // This will fail but we can catch the error to verify connection
      await this.expo.sendPushNotificationsAsync([testMessage]);
    } catch (error) {
      // Expected to fail with invalid token, but connection should work
      if (error instanceof Error && error.message.includes('InvalidPushTokenError')) {
        logger.info('Expo connection test successful');
        return;
      }
      throw error;
    }
  }

  // Send push notification to single device
  public async sendPushNotification(
    expoPushToken: string,
    notification: Omit<PushNotificationData, 'to'>
  ): Promise<ExpoPushTicket> {
    try {
      if (!Expo.isExpoPushToken(expoPushToken)) {
        throw new Error(`Invalid Expo push token: ${expoPushToken}`);
      }

      const message: ExpoPushMessage = {
        to: expoPushToken,
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
        sound: notification.sound || 'default',
        badge: notification.badge,
        priority: notification.priority || 'default',
        channelId: notification.channelId,
        categoryId: notification.category,
      };

      const tickets = await this.expo.sendPushNotificationsAsync([message]);
      const ticket = tickets[0];

      if (ticket.status === 'error') {
        throw new Error(`Push notification failed: ${ticket.message}`);
      }

      logger.info('Push notification sent successfully:', {
        token: expoPushToken,
        ticketId: ticket.id,
        status: ticket.status,
      });

      return ticket;
    } catch (error) {
      logger.error('Failed to send push notification:', error);
      throw error;
    }
  }

  // Send push notification to multiple devices
  public async sendBulkPushNotification(
    expoPushTokens: string[],
    notification: Omit<PushNotificationData, 'to'>
  ): Promise<ExpoPushTicket[]> {
    try {
      // Filter valid tokens
      const validTokens = expoPushTokens.filter(token => Expo.isExpoPushToken(token));
      
      if (validTokens.length === 0) {
        throw new Error('No valid push tokens provided');
      }

      // Create messages
      const messages: ExpoPushMessage[] = validTokens.map(token => ({
        to: token,
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
        sound: notification.sound || 'default',
        badge: notification.badge,
        priority: notification.priority || 'default',
        channelId: notification.channelId,
        categoryId: notification.category,
      }));

      // Send in batches (Expo recommends max 100 per batch)
      const batchSize = 100;
      const batches = this.chunkArray(messages, batchSize);
      const allTickets: ExpoPushTicket[] = [];

      for (const batch of batches) {
        const tickets = await this.expo.sendPushNotificationsAsync(batch);
        allTickets.push(...tickets);
      }

      logger.info('Bulk push notification sent:', {
        totalTokens: expoPushTokens.length,
        validTokens: validTokens.length,
        tickets: allTickets.length,
      });

      return allTickets;
    } catch (error) {
      logger.error('Failed to send bulk push notification:', error);
      throw error;
    }
  }

  // Send push notification to user
  public async sendPushNotificationToUser(
    userId: string,
    notification: Omit<PushNotificationData, 'to'>
  ): Promise<void> {
    try {
      const userTokens = await this.getUserPushTokens(userId);
      
      if (userTokens.length === 0) {
        logger.warn('No push tokens found for user:', { userId });
        return;
      }

      const expoPushTokens = userTokens.map(token => token.expoPushToken);
      await this.sendBulkPushNotification(expoPushTokens, notification);
      
      logger.info('Push notification sent to user:', { userId, tokenCount: userTokens.length });
    } catch (error) {
      logger.error('Failed to send push notification to user:', error);
      throw error;
    }
  }

  // Send push notification to multiple users
  public async sendPushNotificationToUsers(
    userIds: string[],
    notification: Omit<PushNotificationData, 'to'>
  ): Promise<void> {
    try {
      const allTokens = await this.getUsersPushTokens(userIds);
      
      if (allTokens.length === 0) {
        logger.warn('No push tokens found for users:', { userIds });
        return;
      }

      const expoPushTokens = allTokens.map(token => token.expoPushToken);
      await this.sendBulkPushNotification(expoPushTokens, notification);
      
      logger.info('Push notification sent to users:', { 
        userIds: userIds.length, 
        tokenCount: allTokens.length 
      });
    } catch (error) {
      logger.error('Failed to send push notification to users:', error);
      throw error;
    }
  }

  // Send push notification to all active users
  public async sendPushNotificationToAllUsers(
    notification: Omit<PushNotificationData, 'to'>
  ): Promise<void> {
    try {
      const allTokens = await this.getAllActivePushTokens();
      
      if (allTokens.length === 0) {
        logger.warn('No active push tokens found');
        return;
      }

      const expoPushTokens = allTokens.map(token => token.expoPushToken);
      await this.sendBulkPushNotification(expoPushTokens, notification);
      
      logger.info('Push notification sent to all users:', { tokenCount: allTokens.length });
    } catch (error) {
      logger.error('Failed to send push notification to all users:', error);
      throw error;
    }
  }

  // Save user push token
  public async saveUserPushToken(
    userId: string,
    expoPushToken: string,
    deviceId: string,
    platform: 'ios' | 'android' | 'web'
  ): Promise<void> {
    try {
      if (!Expo.isExpoPushToken(expoPushToken)) {
        throw new Error(`Invalid Expo push token: ${expoPushToken}`);
      }

      const tokenData: UserPushToken = {
        userId,
        expoPushToken,
        deviceId,
        platform,
        isActive: true,
        lastUsed: new Date(),
        createdAt: new Date(),
      };

      // Check if token already exists
      const existingToken = await this.getUserPushTokenByDevice(userId, deviceId);
      
      if (existingToken) {
        // Update existing token
        await this.updateUserPushToken(existingToken.id as string, tokenData);
        logger.info('User push token updated:', { userId, deviceId });
      } else {
        // Create new token
        await this.createUserPushToken(tokenData);
        logger.info('User push token created:', { userId, deviceId });
      }
    } catch (error) {
      logger.error('Failed to save user push token:', error);
      throw error;
    }
  }

  // Deactivate user push token
  public async deactivateUserPushToken(
    userId: string,
    deviceId: string
  ): Promise<void> {
    try {
      const token = await this.getUserPushTokenByDevice(userId, deviceId);
      
      if (token) {
        await this.updateUserPushToken(token.id as string, { isActive: false });
        logger.info('User push token deactivated:', { userId, deviceId });
      }
    } catch (error) {
      logger.error('Failed to deactivate user push token:', error);
      throw error;
    }
  }

  // Get user push tokens
  private async getUserPushTokens(userId: string): Promise<UserPushToken[]> {
    try {
      // Mock Firestore query
      logger.debug(`Mock PushNotificationService: Getting tokens for user ${userId}`);
      return [] as UserPushToken[];
    } catch (error) {
      logger.error('Failed to get user push tokens:', error);
      return [];
    }
  }

  // Get multiple users push tokens
  private async getUsersPushTokens(userIds: string[]): Promise<UserPushToken[]> {
    try {
      // Mock Firestore query
      logger.debug(`Mock PushNotificationService: Getting tokens for users ${userIds.join(', ')}`);
      const snapshot = { docs: [] };

      return [] as UserPushToken[];
    } catch (error) {
      logger.error('Failed to get users push tokens:', error);
      return [];
    }
  }

  // Get all active push tokens
  private async getAllActivePushTokens(): Promise<UserPushToken[]> {
    try {
      // Mock Firestore query
      logger.debug('Mock PushNotificationService: Getting all active push tokens');
      return [] as UserPushToken[];
    } catch (error) {
      logger.error('Failed to get all active push tokens:', error);
      return [];
    }
  }

  // Get user push token by device
  private async getUserPushTokenByDevice(
    userId: string,
    deviceId: string
  ): Promise<UserPushToken | null> {
    try {
      // Mock Firestore query
      logger.debug(`Mock PushNotificationService: Getting token for user ${userId}, device ${deviceId}`);
      return null; // Return null for testing
    } catch (error) {
      logger.error('Failed to get user push token by device:', error);
      return null;
    }
  }

  // Create user push token
  private async createUserPushToken(tokenData: UserPushToken): Promise<void> {
    try {
      // Mock Firestore add
      logger.debug('Mock PushNotificationService: Creating user push token', tokenData);
    } catch (error) {
      logger.error('Failed to create user push token:', error);
      throw error;
    }
  }

  // Update user push token
  private async updateUserPushToken(
    tokenId: string,
    updateData: Partial<UserPushToken>
  ): Promise<void> {
    try {
      // Mock Firestore update
      logger.debug(`Mock PushNotificationService: Updating token ${tokenId}`, updateData);
    } catch (error) {
      logger.error('Failed to update user push token:', error);
      throw error;
    }
  }

  // Chunk array into smaller arrays
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  // Get push notification statistics
  public async getPushNotificationStats(): Promise<{
    totalTokens: number;
    activeTokens: number;
    platformBreakdown: { [key: string]: number };
  }> {
    try {
      const allTokens = await this.getAllActivePushTokens();
      
      const platformBreakdown = allTokens.reduce((acc, token) => {
        acc[token.platform] = (acc[token.platform] || 0) + 1;
        return acc;
      }, {} as { [key: string]: number });

      return {
        totalTokens: allTokens.length,
        activeTokens: allTokens.filter(token => token.isActive).length,
        platformBreakdown,
      };
    } catch (error) {
      logger.error('Failed to get push notification stats:', error);
      return {
        totalTokens: 0,
        activeTokens: 0,
        platformBreakdown: {},
      };
    }
  }

  // Clean up inactive tokens
  public async cleanupInactiveTokens(daysInactive: number = 30): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysInactive);

      // Mock Firestore cleanup
      logger.debug(`Mock PushNotificationService: Cleaning up inactive tokens older than ${daysInactive} days`);
      
      logger.info('Inactive push tokens cleaned up:', { count: 0 });
    } catch (error) {
      logger.error('Failed to cleanup inactive tokens:', error);
    }
  }
}

export const pushNotificationService = PushNotificationService.getInstance();

interface FirebasePushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

class FirebasePushNotificationService {
  async sendPushNotification(token: string, payload: FirebasePushPayload): Promise<void> {
    if (!token) {
      return;
    }

    try {
      await admin.messaging().send({
        token,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data,
      });
    } catch (error) {
      logger.error({ err: error, token }, 'Failed to send Firebase push notification');
      throw error;
    }
  }
}

export const firebasePushNotificationService = new FirebasePushNotificationService();

