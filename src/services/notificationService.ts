import fs from 'fs';
import path from 'path';
import { auditService } from './auditService';
import { config } from '../config';
import { emailService } from './emailService';
import { firebasePushNotificationService } from './pushNotificationService';
import { logger } from '../utils/logger';

export interface DeleteNotificationUser {
  id: string;
  email?: string;
  name?: string;
  language?: string;
  pushToken?: string;
  fcmToken?: string;
  expoPushToken?: string;
  notificationToken?: string;
}

const templatesRoot = path.join(__dirname, '../templates/emails');
const startedTemplate = fs.readFileSync(path.join(templatesRoot, 'deleteAccountStarted.html'), 'utf-8');
const completedTemplate = fs.readFileSync(path.join(templatesRoot, 'deleteAccountCompleted.html'), 'utf-8');

class NotificationService {
  private getDisplayName(user: DeleteNotificationUser) {
    if (user.name && user.name.trim() !== '') {
      return user.name;
    }
    if (user.email) {
      return user.email.split('@')[0];
    }
    return 'Kullanıcı';
  }

  private render(template: string, replacements: Record<string, string | number>) {
    let output = template;
    Object.entries(replacements).forEach(([key, value]) => {
      const placeholder = `{{${key}}}`;
      output = output.replace(new RegExp(placeholder, 'g'), String(value));
    });
    return output;
  }

  private shouldSend() {
    return !config.notification.suppressInTest;
  }

  private getPushToken(user: DeleteNotificationUser) {
    return (
      user.pushToken ||
      user.fcmToken ||
      user.notificationToken ||
      user.expoPushToken ||
      undefined
    );
  }

  private async dispatchEmail(to: string, subject: string, html: string): Promise<void> {
    if (!to || !this.shouldSend()) {
      logger.info({ to, subject }, 'Skipping email because recipient missing or notifications suppressed');
      return;
    }
    await emailService.sendMail(to, subject, html);
  }

  private async dispatchPush(user: DeleteNotificationUser, payload: { title: string; body: string }): Promise<void> {
    if (!this.shouldSend()) {
      logger.info({ userId: user.id }, 'Skipping push because notifications suppressed');
      return;
    }
    const token = this.getPushToken(user);
    if (!token) {
      logger.debug({ userId: user.id }, 'No push token available for delete account notification');
      return;
    }
    await firebasePushNotificationService.sendPushNotification(token, {
      title: payload.title,
      body: payload.body,
      data: {
        type: 'DELETE_ACCOUNT_NOTIFICATION',
        step: payload.title.includes('başlatıldı') ? 'started' : 'completed',
      },
    });
  }

  private async handleNotificationFailure(userId: string, step: 'started' | 'completed', error: unknown) {
    try {
      await auditService.logUserAction(userId, 'delete_account_notification_failed', {
        step,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
    } catch (err) {
      logger.error({ err, userId, step }, 'Failed to log notification failure');
    }
  }

  async sendDeleteAccountStarted(user: DeleteNotificationUser) {
    const replacements = {
      userName: this.getDisplayName(user),
      restoreWindowDays: config.notification.restoreWindowDays,
      supportEmail: config.notification.supportEmail,
    };
    const html = this.render(startedTemplate, replacements);

    const tasks = [
      this.dispatchEmail(user.email || '', 'Account deletion started', html),
      this.dispatchPush(user, {
        title: 'Hesap silme süreci başladı',
        body: 'Hesabınız için silme işlemi başlatıldı. Detaylar e-postanıza gönderildi.',
      }),
    ];

    const results = await Promise.allSettled(tasks);
    for (const result of results) {
      if (result.status === 'rejected') {
        await this.handleNotificationFailure(user.id, 'started', result.reason);
      }
    }
  }

  async sendDeleteAccountCompleted(user: DeleteNotificationUser) {
    const replacements = {
      userName: this.getDisplayName(user),
      restoreWindowDays: config.notification.restoreWindowDays,
      supportEmail: config.notification.supportEmail,
    };
    const html = this.render(completedTemplate, replacements);

    const tasks = [
      this.dispatchEmail(user.email || '', 'Account deleted', html),
      this.dispatchPush(user, {
        title: 'Hesabınız silindi',
        body: 'Hesabınızın silme işlemi tamamlandı.',
      }),
    ];

    const results = await Promise.allSettled(tasks);
    for (const result of results) {
      if (result.status === 'rejected') {
        await this.handleNotificationFailure(user.id, 'completed', result.reason);
      }
    }
  }
}

export const notificationService = new NotificationService();

