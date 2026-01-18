// import { getFirestore } from 'firebase-admin/firestore'; // Temporarily disabled
import { logger } from '../utils/logger';
import { cacheService } from './cacheService';
import { firestoreQuery } from '../firebase';

export interface AuditEvent {
  id?: string;
  userId?: string;
  sessionId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: any;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
  success: boolean;
  errorMessage?: string;
  metadata?: any;
}

export interface AuditQuery {
  userId?: string;
  action?: string;
  resource?: string;
  startDate?: Date;
  endDate?: Date;
  success?: boolean;
  limit?: number;
  offset?: number;
}

export interface AuditStats {
  totalEvents: number;
  eventsByAction: Record<string, number>;
  eventsByResource: Record<string, number>;
  eventsByUser: Record<string, number>;
  successRate: number;
  errorRate: number;
  timeRange: {
    start: Date;
    end: Date;
  };
}

class AuditService {
  private static instance: AuditService;
  private firestore: any;
  private collectionName = 'audit_logs';

  private constructor() {
    // this.firestore = getFirestore(); // Temporarily disabled
    this.firestore = null; // Mock firestore
  }

  public static getInstance(): AuditService {
    if (!AuditService.instance) {
      AuditService.instance = new AuditService();
    }
    return AuditService.instance;
  }

  // Log an audit event
  public async logEvent(event: Omit<AuditEvent, 'timestamp'>): Promise<void> {
    try {
      const auditEvent: AuditEvent = {
        ...event,
        timestamp: new Date(),
      };

      // Add to Firestore (temporarily disabled)
      // await this.firestore.collection(this.collectionName).add(auditEvent);
      logger.debug('Mock Audit: Event logged', auditEvent);

      // Add to cache for quick access
      await this.cacheRecentEvent(auditEvent);

      logger.info('Audit event logged', {
        action: event.action,
        resource: event.resource,
        userId: event.userId,
        success: event.success,
      });

    } catch (error) {
      logger.error('Failed to log audit event:', error);
      // Don't throw error to avoid breaking the main flow
    }
  }

  // Log authentication events
  public async logAuthEvent(
    action: 'login' | 'logout' | 'register' | 'password_reset' | 'email_verification' | 'password_reset_request' | 'password_reset_success' | 'password_reset_confirm' | 'refresh' | 'reuse_detected' | 'logout_all',
    details: any,
    success?: boolean
  ): Promise<void> {
    const { userId, ipAddress, userAgent, ...otherDetails } = details;
    await this.logEvent({
      userId: userId || '',
      action,
      resource: 'authentication',
      details: otherDetails,
      ipAddress,
      userAgent,
      success: success !== undefined ? success : true,
    });
  }

  // Log API events
  public async logApiEvent(
    action: 'create' | 'read' | 'update' | 'delete' | 'search',
    resource: string,
    resourceId: string,
    userId: string,
    success: boolean,
    details?: any,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.logEvent({
      userId,
      action,
      resource,
      resourceId,
      details,
      ipAddress,
      userAgent,
      success,
    });
  }

  // Log user actions
  public async logUserAction(
    userId: string,
    action: string,
    details?: any,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.logEvent({
      userId,
      action,
      resource: 'user_action',
      details,
      ipAddress,
      userAgent,
      success: true,
    });
  }

  // Log chat events
  public async logChatEvent(
    action: 'create' | 'update' | 'delete' | 'message_sent' | 'file_uploaded',
    chatId: string,
    userId: string,
    success: boolean,
    details?: any,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.logEvent({
      userId,
      action,
      resource: 'chat',
      resourceId: chatId,
      details,
      ipAddress,
      userAgent,
      success,
    });
  }

  // Log file events
  public async logFileEvent(
    action: 'upload' | 'download' | 'delete' | 'process',
    fileId: string,
    userId: string,
    success: boolean,
    details?: any,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.logEvent({
      userId,
      action,
      resource: 'file',
      resourceId: fileId,
      details,
      ipAddress,
      userAgent,
      success,
    });
  }

  // Log security events
  public async logSecurityEvent(
    action: 'suspicious_activity' | 'rate_limit_exceeded' | 'unauthorized_access' | 'data_breach',
    userId: string,
    details: any,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.logEvent({
      userId,
      action,
      resource: 'security',
      details,
      ipAddress,
      userAgent,
      success: false, // Security events are typically failures
    });
  }

  // Query audit events
  public async queryEvents(query: AuditQuery): Promise<AuditEvent[]> {
    try {
      // let firestoreQuery = this.firestore.collection(this.collectionName); // Temporarily disabled
      logger.debug('Mock Audit: Query events', query);
      return []; // Return empty array for testing

      // Apply filters
      let queryBuilder = firestoreQuery;
      if (query.userId) {
        queryBuilder = queryBuilder.where('userId', '==', query.userId);
      }
      if (query.action) {
        queryBuilder = queryBuilder.where('action', '==', query.action);
      }
      if (query.resource) {
        queryBuilder = queryBuilder.where('resource', '==', query.resource);
      }
      if (query.success !== undefined) {
        queryBuilder = queryBuilder.where('success', '==', query.success);
      }
      if (query.startDate) {
        queryBuilder = queryBuilder.where('timestamp', '>=', query.startDate);
      }
      if (query.endDate) {
        queryBuilder = queryBuilder.where('timestamp', '<=', query.endDate);
      }

      // Apply ordering and pagination
      queryBuilder = queryBuilder.orderBy('timestamp', 'desc');
      
      if (query.offset !== undefined && query.offset !== null) {
        queryBuilder = queryBuilder.offset(query.offset as number);
      }
      if (query.limit !== undefined && query.limit !== null) {
        queryBuilder = queryBuilder.limit(query.limit as number);
      }

      const snapshot = await queryBuilder.get();
      const events: AuditEvent[] = [];

      snapshot.forEach((doc: any) => {
        events.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      return events;

    } catch (error) {
      logger.error('Failed to query audit events:', error);
      return [];
    }
  }

  // Get audit statistics
  public async getAuditStats(
    startDate: Date,
    endDate: Date,
    userId?: string
  ): Promise<AuditStats> {
    try {
      let query = this.firestore
        .collection(this.collectionName)
        .where('timestamp', '>=', startDate)
        .where('timestamp', '<=', endDate);

      if (userId) {
        query = query.where('userId', '==', userId);
      }

      const snapshot = await query.get();
      const events: AuditEvent[] = [];

      snapshot.forEach((doc: any) => {
        events.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      // Calculate statistics
      const totalEvents = events.length;
      const successfulEvents = events.filter(e => e.success).length;
      const failedEvents = totalEvents - successfulEvents;

      const eventsByAction: Record<string, number> = {};
      const eventsByResource: Record<string, number> = {};
      const eventsByUser: Record<string, number> = {};

      events.forEach(event => {
        // Count by action
        eventsByAction[event.action] = (eventsByAction[event.action] || 0) + 1;
        
        // Count by resource
        eventsByResource[event.resource] = (eventsByResource[event.resource] || 0) + 1;
        
        // Count by user
        if (event.userId) {
          eventsByUser[event.userId] = (eventsByUser[event.userId] || 0) + 1;
        }
      });

      return {
        totalEvents,
        eventsByAction,
        eventsByResource,
        eventsByUser,
        successRate: totalEvents > 0 ? (successfulEvents / totalEvents) * 100 : 0,
        errorRate: totalEvents > 0 ? (failedEvents / totalEvents) * 100 : 0,
        timeRange: {
          start: startDate,
          end: endDate,
        },
      };

    } catch (error) {
      logger.error('Failed to get audit stats:', error);
      return {
        totalEvents: 0,
        eventsByAction: {},
        eventsByResource: {},
        eventsByUser: {},
        successRate: 0,
        errorRate: 0,
        timeRange: {
          start: startDate,
          end: endDate,
        },
      };
    }
  }

  // Get user activity summary
  public async getUserActivitySummary(
    userId: string,
    days: number = 30
  ): Promise<any> {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const events = await this.queryEvents({
        userId,
        startDate,
        endDate,
        limit: 1000,
      });

      const summary = {
        userId,
        period: { start: startDate, end: endDate },
        totalEvents: events.length,
        lastActivity: events.length > 0 ? events[0].timestamp : null,
        activityByDay: this.groupEventsByDay(events),
        topActions: this.getTopActions(events),
        topResources: this.getTopResources(events),
        successRate: this.calculateSuccessRate(events),
      };

      return summary;

    } catch (error) {
      logger.error('Failed to get user activity summary:', error);
      return null;
    }
  }

  // Cleanup old audit logs
  public async cleanupOldAuditLogs(retentionDays: number): Promise<number> {
    try {
      // Temporarily disabled for testing
      logger.debug('Mock Audit: Cleanup old audit logs', { retentionDays });
      return 0;
    } catch (error) {
      logger.error('Failed to cleanup old audit logs:', error);
      return 0;
    }
  }

  // Cache recent events for quick access
  private async cacheRecentEvent(event: AuditEvent): Promise<void> {
    try {
      const cacheKey = `audit:recent:${event.userId || 'anonymous'}`;
      const recentEvents = await cacheService.get<AuditEvent[]>(cacheKey) || [];
      
      recentEvents.unshift(event);
      
      // Keep only last 50 events
      const trimmedEvents = recentEvents.slice(0, 50);
      
      await cacheService.set(cacheKey, trimmedEvents, 3600); // 1 hour
    } catch (error) {
      logger.error('Failed to cache recent event:', error);
    }
  }

  // Helper methods
  private groupEventsByDay(events: AuditEvent[]): Record<string, number> {
    const grouped: Record<string, number> = {};
    
    events.forEach(event => {
      const day = event.timestamp.toISOString().split('T')[0];
      grouped[day] = (grouped[day] || 0) + 1;
    });
    
    return grouped;
  }

  private getTopActions(events: AuditEvent[], limit: number = 5): Array<{ action: string; count: number }> {
    const actionCounts: Record<string, number> = {};
    
    events.forEach(event => {
      actionCounts[event.action] = (actionCounts[event.action] || 0) + 1;
    });
    
    return Object.entries(actionCounts)
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  private getTopResources(events: AuditEvent[], limit: number = 5): Array<{ resource: string; count: number }> {
    const resourceCounts: Record<string, number> = {};
    
    events.forEach(event => {
      resourceCounts[event.resource] = (resourceCounts[event.resource] || 0) + 1;
    });
    
    return Object.entries(resourceCounts)
      .map(([resource, count]) => ({ resource, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  private calculateSuccessRate(events: AuditEvent[]): number {
    if (events.length === 0) return 0;
    
    const successfulEvents = events.filter(e => e.success).length;
    return (successfulEvents / events.length) * 100;
  }

  // Export audit data
  public async exportAuditData(
    startDate: Date,
    endDate: Date,
    format: 'json' | 'csv' = 'json'
  ): Promise<string> {
    try {
      const events = await this.queryEvents({
        startDate,
        endDate,
        limit: 10000, // Max export limit
      });

      if (format === 'json') {
        return JSON.stringify(events, null, 2);
      } else {
        // Convert to CSV
        const headers = ['id', 'userId', 'action', 'resource', 'resourceId', 'timestamp', 'success', 'ipAddress'];
        const csvRows = [headers.join(',')];
        
        events.forEach(event => {
          const row = headers.map(header => {
            const value = event[header as keyof AuditEvent];
            return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value || '';
          });
          csvRows.push(row.join(','));
        });
        
        return csvRows.join('\n');
      }

    } catch (error) {
      logger.error('Failed to export audit data:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const auditService = AuditService.getInstance();