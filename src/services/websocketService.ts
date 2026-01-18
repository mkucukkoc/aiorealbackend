import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { logger } from '../utils/logger';
import { TokenService } from './tokenService';
import { UserService } from './userService';
import { SessionService } from './sessionService';
import { auditService } from './auditService';
import { getAllowedOriginsSnapshot, isWebSocketOriginAllowed } from '../utils/cors';

export interface SocketUser {
  userId: string;
  socketId: string;
  deviceId: string;
  lastSeen: Date;
}

export interface ChatMessage {
  id: string;
  userId: string;
  chatId: string;
  content: string;
  timestamp: Date;
  type: 'text' | 'image' | 'file';
}

export interface TypingIndicator {
  userId: string;
  chatId: string;
  isTyping: boolean;
}

export class WebSocketService {
  private io: SocketIOServer;
  private connectedUsers: Map<string, SocketUser> = new Map();
  private userSockets: Map<string, string> = new Map(); // userId -> socketId

  constructor(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: (origin, callback) => {
          if (isWebSocketOriginAllowed(origin)) {
            callback(null, true);
            return;
          }

          logger.warn({ origin }, 'WebSocket origin rejected by CORS policy');
          callback(new Error('Not allowed by CORS'));
        },
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    logger.info({ allowedOrigins: getAllowedOriginsSnapshot(), transports: ['websocket', 'polling'] }, 'WebSocket server initialized with CORS support');

    this.setupMiddleware();
    this.setupEventHandlers();
  }

  private setupMiddleware() {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        // Verify token directly without Express middleware
        const decoded = await this.verifyToken(token);
        
        if (!decoded) {
          return next(new Error('Invalid token'));
        }

        // Get user information
        const user = await this.getUserById(decoded.sub);
        
        if (!user) {
          return next(new Error('User not found'));
        }

        socket.data.user = {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar: user.avatar,
        };
        next();
      } catch (error) {
        logger.error({ error }, 'WebSocket authentication failed');
        next(new Error('Authentication failed'));
      }
    });
  }

  private async verifyToken(token: string): Promise<any> {
    try {
      const decoded = await TokenService.verifyAccessToken(token);
      return decoded;
    } catch (error) {
      logger.error({ error }, 'Token verification failed');
      return null;
    }
  }

  private async getUserById(userId: string): Promise<any> {
    try {
      const user = await UserService.findById(userId);
      return user;
    } catch (error) {
      logger.error({ error, userId }, 'Failed to get user by ID');
      return null;
    }
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket) => {
      const user = socket.data.user;
      const deviceId = socket.handshake.auth.deviceId || 'unknown';

      logger.info({ userId: user.id, socketId: socket.id }, 'User connected to WebSocket');

      // Store user connection
      this.connectedUsers.set(socket.id, {
        userId: user.id,
        socketId: socket.id,
        deviceId,
        lastSeen: new Date(),
      });
      this.userSockets.set(user.id, socket.id);

      // Join user to their personal room
      socket.join(`user:${user.id}`);

      // Handle chat events
      this.setupChatEvents(socket);
      
      // Handle typing indicators
      this.setupTypingEvents(socket);
      
      // Handle presence events
      this.setupPresenceEvents(socket);

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        logger.info({ userId: user.id, socketId: socket.id, reason }, 'User disconnected from WebSocket');
        
        this.connectedUsers.delete(socket.id);
        this.userSockets.delete(user.id);
        
        // Notify other users about disconnection
        socket.broadcast.emit('user:offline', {
          userId: user.id,
          timestamp: new Date(),
        });
      });

      // Handle errors
      socket.on('error', (error) => {
        logger.error({ userId: user.id, error }, 'WebSocket error');
      });
    });
  }

  private setupChatEvents(socket: any) {
    // Join chat room
    socket.on('chat:join', async (data: { chatId: string }) => {
      try {
        const { chatId } = data;
        socket.join(`chat:${chatId}`);
        
        logger.info({ 
          userId: socket.data.user.id, 
          chatId 
        }, 'User joined chat room');

        // Notify others in the chat
        socket.to(`chat:${chatId}`).emit('chat:user_joined', {
          userId: socket.data.user.id,
          chatId,
          timestamp: new Date(),
        });
      } catch (error) {
        logger.error({ error }, 'Error joining chat room');
        socket.emit('error', { message: 'Failed to join chat room' });
      }
    });

    // Leave chat room
    socket.on('chat:leave', async (data: { chatId: string }) => {
      try {
        const { chatId } = data;
        socket.leave(`chat:${chatId}`);
        
        logger.info({ 
          userId: socket.data.user.id, 
          chatId 
        }, 'User left chat room');

        // Notify others in the chat
        socket.to(`chat:${chatId}`).emit('chat:user_left', {
          userId: socket.data.user.id,
          chatId,
          timestamp: new Date(),
        });
      } catch (error) {
        logger.error({ error }, 'Error leaving chat room');
        socket.emit('error', { message: 'Failed to leave chat room' });
      }
    });

    // Send message
    socket.on('chat:message', async (data: { chatId: string; content: string; type?: string }) => {
      try {
        const { chatId, content, type = 'text' } = data;
        const user = socket.data.user;

        const message: ChatMessage = {
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          userId: user.id,
          chatId,
          content,
          timestamp: new Date(),
          type: type as any,
        };

        // Broadcast message to all users in the chat
        this.io.to(`chat:${chatId}`).emit('chat:message', message);

        // Log message for audit
        await auditService.logUserAction(user.id, 'chat_message', {
          chatId,
          messageId: message.id,
          messageType: type,
        });

        logger.info({ 
          userId: user.id, 
          chatId, 
          messageId: message.id 
        }, 'Message sent via WebSocket');
      } catch (error) {
        logger.error({ error }, 'Error sending message');
        socket.emit('error', { message: 'Failed to send message' });
      }
    });
  }

  private setupTypingEvents(socket: any) {
    socket.on('typing:start', (data: { chatId: string }) => {
      const { chatId } = data;
      const user = socket.data.user;

      const typingIndicator: TypingIndicator = {
        userId: user.id,
        chatId,
        isTyping: true,
      };

      // Notify others in the chat
      socket.to(`chat:${chatId}`).emit('typing:indicator', typingIndicator);
    });

    socket.on('typing:stop', (data: { chatId: string }) => {
      const { chatId } = data;
      const user = socket.data.user;

      const typingIndicator: TypingIndicator = {
        userId: user.id,
        chatId,
        isTyping: false,
      };

      // Notify others in the chat
      socket.to(`chat:${chatId}`).emit('typing:indicator', typingIndicator);
    });
  }

  private setupPresenceEvents(socket: any) {
    // Send online status
    socket.on('presence:online', () => {
      const user = socket.data.user;
      
      // Notify all connected users
      socket.broadcast.emit('user:online', {
        userId: user.id,
        timestamp: new Date(),
      });
    });

    // Send offline status
    socket.on('presence:offline', () => {
      const user = socket.data.user;
      
      // Notify all connected users
      socket.broadcast.emit('user:offline', {
        userId: user.id,
        timestamp: new Date(),
      });
    });
  }

  // Public methods for server-side usage
  public sendToUser(userId: string, event: string, data: any) {
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.io.to(socketId).emit(event, data);
    }
  }

  public sendToChat(chatId: string, event: string, data: any) {
    this.io.to(`chat:${chatId}`).emit(event, data);
  }

  public broadcast(event: string, data: any) {
    this.io.emit(event, data);
  }

  public getConnectedUsers(): SocketUser[] {
    return Array.from(this.connectedUsers.values());
  }

  public isUserOnline(userId: string): boolean {
    return this.userSockets.has(userId);
  }

  public getOnlineUsers(): string[] {
    return Array.from(this.userSockets.keys());
  }
}

// Singleton instance
let websocketService: WebSocketService | null = null;

export const initializeWebSocket = (httpServer: HTTPServer): WebSocketService => {
  if (!websocketService) {
    websocketService = new WebSocketService(httpServer);
  }
  return websocketService;
};

export const getWebSocketService = (): WebSocketService | null => {
  return websocketService;
};
