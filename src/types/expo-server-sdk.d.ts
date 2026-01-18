declare module 'expo-server-sdk' {
  export interface ExpoPushMessage {
    to: string | string[];
    title?: string;
    body?: string;
    data?: any;
    sound?: string;
    badge?: number;
    priority?: 'default' | 'normal' | 'high';
    channelId?: string;
    category?: string;
    categoryId?: string;
  }

  export interface ExpoPushTicket {
    id: string;
    status: 'ok' | 'error';
    message?: string;
    details?: any;
  }

  export class Expo {
    constructor(options?: {
      accessToken?: string;
      useFcmV1?: boolean;
    });

    static isExpoPushToken(token: string): boolean;
    isExpoPushToken(token: string): boolean;
    sendPushNotificationsAsync(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
  }
}
