export interface User {
  id: string;
  email: string;
  passwordHash: string;
  provider?: 'password' | 'google' | 'apple' | string;
  name?: string;
  avatar?: string;
  isEmailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
  failedLoginAttempts: number;
  lockedUntil?: Date;
}

export interface Session {
  id: string;
  userId: string;
  refreshTokenHash: string;
  deviceInfo: DeviceInfo;
  deviceId?: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  ipAddress?: string;
  userAgent?: string;
}

export interface DeviceInfo {
  os?: string;
  model?: string;
  appVersion?: string;
  platform?: string;
}

export interface AuthTokens {
  accessToken: string;
  accessExp: number;
  refreshToken: string;
  refreshExp: number;
  sessionId: string;
}

export interface AuthResponse extends AuthTokens {
  user: {
    id: string;
    email: string;
    name?: string;
    avatar?: string;
  };
  deviceId?: string;
  firebaseCustomToken?: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  device: DeviceInfo;
  deviceId?: string;
  name?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  device: DeviceInfo;
  deviceId?: string;
}

export interface RefreshRequest {
  refreshToken: string;
  sessionId: string;
  deviceId?: string;
}

export interface LogoutRequest {
  sessionId: string;
}

export interface AccessTokenClaims {
  sub: string; // user_id
  sid: string; // session_id
  jti: string; // JWT ID
  iat: number; // issued at
  exp: number; // expires at
  iss: string; // issuer
  aud: string; // audience
}

export interface AuditLog {
  id: string;
  userId?: string;
  sessionId?: string;
  event: 'login' | 'logout' | 'refresh' | 'reuse_detected' | 'register' | 'logout_all' | 'password_reset_request' | 'password_reset_success' | 'password_reset_confirm';
  ipAddress?: string;
  userAgent?: string;
  deviceInfo?: DeviceInfo;
  success: boolean;
  errorMessage?: string;
  createdAt: Date;
}
