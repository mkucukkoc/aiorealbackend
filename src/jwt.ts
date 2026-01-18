import jwt from 'jsonwebtoken';
import { config } from './config';

type AccessClaims = {
  sub: string;
  type: 'access';
  device_id: string;
  iss: string;
  aud: string;
};

export function signAccessJwt(userId: string, deviceId: string): string {
  const payload: AccessClaims = {
    sub: userId,
    type: 'access',
    device_id: deviceId,
    iss: config.jwt.iss,
    aud: config.jwt.aud,
  };
  return jwt.sign(payload, config.jwt.hsSecret, {
    algorithm: 'HS256',
    expiresIn: `${config.jwt.accessTtlMin}m`,
  });
}

export function verifyAccessJwt(token: string): AccessClaims {
  return jwt.verify(token, config.jwt.hsSecret, {
    algorithms: ['HS256'],
    audience: config.jwt.aud,
    issuer: config.jwt.iss,
  }) as AccessClaims;
}


