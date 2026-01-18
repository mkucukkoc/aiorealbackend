import { Router } from 'express';
import { randomInt, createHash } from 'crypto';
import { sendOtpEmail } from '../email';
import { getJson, setJson } from '../redis';
import { config } from '../config';
import { TokenService } from '../services/tokenService';
import { db } from '../firebase';
import { logger } from '../utils/logger';
import { attachRouteLogger } from '../utils/routeLogger';

export function createEmailOtpRouter(): Router {
  const r = Router();
  attachRouteLogger(r, 'emailOtp');

  r.post('/start', async (req, res) => {
    const { email } = req.body || {};
    logEmailOtp('start_request_received', { route: '/start', emailPresent: !!email });
    if (!email) {
      logEmailOtp('start_missing_email');
      return res.status(400).json({ error: 'invalid_request' });
    }
    const key = `otp:rl:${email}`;
    const rl = (await getJson<{ count: number }>(key)) || { count: 0 };
    logEmailOtp('start_rate_limit_status', { count: rl.count });
    if (rl.count >= 5) {
      logEmailOtp('start_rate_limited', { email });
      return res.status(429).json({ error: 'rate_limited' });
    }
    rl.count += 1;
    await setJson(key, rl, 600);
    logEmailOtp('start_rate_limit_incremented', { count: rl.count });

    const code = (randomInt(0, 999999) + '').padStart(6, '0');
    const codeHash = sha256(code);
    logEmailOtp('start_code_generated', { email });
    await db.collection('otpCodes').add({ email, codeHash, expiresAt: new Date(Date.now() + 10 * 60 * 1000), createdAt: new Date() });
    logEmailOtp('start_code_persisted', { email });
    try {
      await sendOtpEmail(email, code);
      logEmailOtp('start_email_sent', { email });
    } catch (error) {
      logEmailOtp('start_email_failed', { email, error: (error as Error)?.message });
    }
    logEmailOtp('start_response_ready', { email });
    return res.json({ ok: true });
  });

  r.post('/verify', async (req, res) => {
    const { email, otp, device_id, device_name } = req.body || {};
    logEmailOtp('verify_request_received', {
      emailPresent: !!email,
      otpPresent: !!otp,
      deviceIdPresent: !!device_id,
    });
    if (!email || !otp || !device_id) {
      logEmailOtp('verify_missing_fields');
      return res.status(400).json({ error: 'invalid_request' });
    }
    const recordSnap = await db
      .collection('otpCodes')
      .where('email', '==', email)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    logEmailOtp('verify_code_lookup_complete', { found: !recordSnap.empty });
    if (recordSnap.empty) {
      logEmailOtp('verify_code_not_found', { email });
      return res.status(400).json({ error: 'invalid_otp' });
    }
    const doc = recordSnap.docs[0];
    const record = doc.data() as any;
    if (record.expiresAt.toDate() < new Date()) {
      logEmailOtp('verify_code_expired', { email });
      return res.status(400).json({ error: 'invalid_otp' });
    }
    const isMatch = record.codeHash === sha256(otp);
    if (!isMatch) {
      logEmailOtp('verify_code_mismatch', { email });
      return res.status(400).json({ error: 'invalid_otp' });
    }
    await doc.ref.delete();
    logEmailOtp('verify_code_consumed', { email });

    // upsert user
    let userId: string;
    const userSnap = await db.collection('users').where('email', '==', email).limit(1).get();
    if (userSnap.empty) {
      const userRef = db.collection('users').doc();
      await userRef.set({ email, isEmailVerified: true, createdAt: new Date() });
      userId = userRef.id;
      logEmailOtp('verify_user_created', { userId, email });
    } else {
      userId = userSnap.docs[0].id;
      logEmailOtp('verify_user_found', { userId, email });
    }

    // upsert device
    let deviceId: string;
    const deviceSnap = await db
      .collection('devices')
      .where('userId', '==', userId)
      .where('deviceId', '==', device_id)
      .limit(1)
      .get();
    if (deviceSnap.empty) {
      const deviceRef = db.collection('devices').doc();
      await deviceRef.set({ userId, deviceId: device_id, deviceName: device_name || 'rn-client', createdAt: new Date() });
      deviceId = deviceRef.id;
      logEmailOtp('verify_device_created', { userId, deviceId });
    } else {
      deviceId = deviceSnap.docs[0].id;
      logEmailOtp('verify_device_found', { userId, deviceId });
    }

    const rawRefresh = base64url(Buffer.from(randomInt(0, 2 ** 31 - 1).toString()));
    const refreshRef = db.collection('refreshTokens').doc();
    await refreshRef.set({
      userId,
      deviceId,
      tokenHash: sha256(rawRefresh),
      expiresAt: addDays(new Date(), config.refreshTtlDays),
      createdAt: new Date(),
    });
    logEmailOtp('verify_refresh_token_created', { refreshTokenId: refreshRef.id });
    const access = await TokenService.createAccessToken(userId, 'email-otp-session');
    logEmailOtp('verify_access_token_created', { userId });
    return res.json({
      access_token: access,
      refresh_token: rawRefresh,
      refresh_token_id: refreshRef.id,
      user_id: userId,
    });
  });

  return r;
}

function logEmailOtp(step: string, data: Record<string, unknown> = {}) {
  logger.info({ step, ...data }, '[EmailOtp]');
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(d.getDate() + days);
  return x;
}
function base64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}



