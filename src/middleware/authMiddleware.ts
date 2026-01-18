import { Request, Response, NextFunction } from 'express';
import { TokenService } from '../services/tokenService';
import { UserService } from '../services/userService';
import { SessionService } from '../services/sessionService';
import { logger } from '../utils/logger';

// Extend Request interface to include user
export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name?: string;
    avatar?: string;
  };
  accessToken?: string;
}

// JWT token authentication middleware
export async function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const requestId = Math.random().toString(36).substring(7);
  const startTime = Date.now();
  
  try {
    logger.info({
      requestId,
      operation: 'authenticateToken',
      endpoint: req.path,
      method: req.method,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      headers: {
        authorization: req.headers.authorization ? 'Bearer ***' : 'none',
        contentType: req.headers['content-type'],
        accept: req.headers.accept
      }
    }, 'Starting authentication process');

    const authHeader = req.headers.authorization;
    logger.debug({
      requestId,
      authHeader: authHeader ? 'Bearer ***' : 'none',
      authHeaderLength: authHeader?.length || 0
    }, 'Authorization header analysis');

    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      logger.warn({
        requestId,
        endpoint: req.path,
        method: req.method,
        authHeader: authHeader || 'none'
      }, 'No access token provided');
      
      res.status(401).json({
        error: 'access_denied',
        message: 'Access token required'
      });
      return;
    }

    logger.info({
      requestId,
      tokenLength: token.length,
      tokenPreview: token.substring(0, 20) + '...',
      tokenParts: token.split('.').map((part, index) => ({
        part: index,
        length: part.length,
        preview: part.substring(0, 10) + '...'
      })),
      endpoint: req.path,
      method: req.method
    }, 'Token analysis completed, starting verification');
    
    const decoded = await TokenService.verifyAccessToken(token);

    logger.info({
      requestId,
      hasDecoded: !!decoded,
      decoded: decoded ? {
        sub: decoded.sub,
        sid: decoded.sid,
        jti: decoded.jti,
        iat: decoded.iat,
        exp: decoded.exp,
        iss: decoded.iss,
        aud: decoded.aud,
        expDate: new Date(decoded.exp * 1000).toISOString(),
        iatDate: new Date(decoded.iat * 1000).toISOString()
      } : null
    }, 'Token verification result');
    
    if (!decoded) {
      logger.warn({
        requestId,
        tokenLength: token.length,
        tokenPreview: token.substring(0, 20) + '...',
        endpoint: req.path,
        method: req.method
      }, 'Token verification failed');
      
      res.status(401).json({
        error: 'invalid_token',
        message: 'Invalid or expired access token'
      });
      return;
    }
    
    logger.info({
      requestId,
      userId: decoded.sub,
      sessionId: decoded.sid,
      endpoint: req.path,
      method: req.method
    }, 'Token verified successfully, fetching user data');

    // Get user information
    logger.debug({
      requestId,
      userId: decoded.sub,
      operation: 'fetchUser'
    }, 'Fetching user from database');
    
    const user = await UserService.findById(decoded.sub);
    
    logger.info({
      requestId,
      userId: decoded.sub,
      hasUser: !!user,
      userData: user ? {
        id: user.id,
        email: user.email,
        name: user.name,
        isLocked: UserService.isUserLocked(user),
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt
      } : null
    }, 'User fetch result');
    
    if (!user) {
      logger.error({
        requestId,
        userId: decoded.sub,
        endpoint: req.path,
        method: req.method
      }, 'User not found in database');
      
      res.status(401).json({
        error: 'user_not_found',
        message: 'User not found'
      });
      return;
    }

    // Check if user is locked
    const isLocked = UserService.isUserLocked(user);
    logger.debug({
      requestId,
      userId: decoded.sub,
      isLocked
    }, 'User lock status check');

    if (isLocked) {
      logger.warn({
        requestId,
        userId: decoded.sub,
        endpoint: req.path,
        method: req.method
      }, 'Account is locked');
      
      res.status(423).json({
        error: 'account_locked',
        message: 'Account is temporarily locked'
      });
      return;
    }

    // Verify session is still active
    logger.info({
      requestId,
      sessionId: decoded.sid,
      userId: decoded.sub,
      operation: 'sessionValidation'
    }, 'Starting session validation');
    
    const session = await SessionService.findById(decoded.sid);
    
    const now = new Date();
    const sessionExpiresAt = session?.expiresAt;
    let isExpired = false;
    let timeUntilExpiry = 0;
    
    if (session && sessionExpiresAt) {
      // Handle Firestore Timestamp objects
      let sessionExpiresAtDate: Date;
      if (sessionExpiresAt && typeof sessionExpiresAt === 'object' && 'toDate' in sessionExpiresAt) {
        // Firestore Timestamp
        sessionExpiresAtDate = (sessionExpiresAt as any).toDate();
      } else if (sessionExpiresAt instanceof Date) {
        // Regular Date
        sessionExpiresAtDate = sessionExpiresAt;
      } else {
        // Fallback
        sessionExpiresAtDate = new Date(sessionExpiresAt);
      }
      
      isExpired = sessionExpiresAtDate < now;
      timeUntilExpiry = sessionExpiresAtDate.getTime() - now.getTime();
    }
    
    logger.info({
      requestId,
      sessionId: decoded.sid,
      hasSession: !!session,
      sessionData: session ? {
        id: session.id,
        userId: session.userId,
        revokedAt: session.revokedAt,
        expiresAt: sessionExpiresAt,
        expiresAtDate: sessionExpiresAt ? (typeof sessionExpiresAt === 'object' && 'toDate' in sessionExpiresAt ? (sessionExpiresAt as any).toDate().toISOString() : new Date(sessionExpiresAt).toISOString()) : null,
        now: now.toISOString(),
        isExpired,
        timeUntilExpiry,
        timeUntilExpiryMinutes: timeUntilExpiry / (1000 * 60)
      } : null
    }, 'Session validation result');
    
    if (!session || session.revokedAt || isExpired) {
      logger.warn({
        requestId,
        sessionId: decoded.sid,
        hasSession: !!session,
        isRevoked: !!session?.revokedAt,
        isExpired,
        revokedAt: session?.revokedAt,
        endpoint: req.path,
        method: req.method
      }, 'Session validation failed');
      
      res.status(401).json({
        error: 'session_expired',
        message: 'Session has expired or been revoked'
      });
      return;
    }
    
    logger.info({
      requestId,
      sessionId: decoded.sid,
      userId: decoded.sub,
      timeUntilExpiry,
      timeUntilExpiryMinutes: timeUntilExpiry / (1000 * 60)
    }, 'Session validation successful');

    // Add user to request object
    (req as AuthRequest).accessToken = token;
    (req as AuthRequest).user = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
    };

    const processingTime = Date.now() - startTime;
    logger.info({
      requestId,
      userId: decoded.sub,
      sessionId: decoded.sid,
      endpoint: req.path,
      method: req.method,
      processingTimeMs: processingTime,
      success: true
    }, 'Authentication completed successfully');

    next();
  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error({
      requestId,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      endpoint: req.path,
      method: req.method,
      processingTimeMs: processingTime,
      operation: 'authentication'
    }, 'Authentication error occurred');
    
    res.status(500).json({
      error: 'internal_error',
      message: 'Authentication failed'
    });
  }
}

// Optional authentication middleware (doesn't fail if no token)
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const decoded = await TokenService.verifyAccessToken(token);
      
      if (decoded) {
        const user = await UserService.findById(decoded.sub);
        
        if (user && !UserService.isUserLocked(user)) {
          const session = await SessionService.findById(decoded.sid);
          
          if (session && !session.revokedAt && session.expiresAt > new Date()) {
            (req as AuthRequest).accessToken = token;
            (req as AuthRequest).user = {
              id: user.id,
              email: user.email,
              name: user.name,
              avatar: user.avatar,
            };
          }
        }
      }
    }

    next();
  } catch (error) {
    // For optional auth, we don't fail on error, just continue without user
    logger.warn({ err: error, operation: 'optionalAuth' }, 'Optional auth error');
    next();
  }
}

// Admin role check middleware
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authReq = req as AuthRequest;
  
  if (!authReq.user) {
    res.status(401).json({
      error: 'access_denied',
      message: 'Authentication required'
    });
    return;
  }

  // For now, we don't have role-based access control
  // This is a placeholder for future implementation
  // You would check user.role or user.permissions here
  
  next();
}
