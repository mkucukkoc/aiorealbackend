"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.revenuecatWebhook = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const crypto_1 = require("crypto");
const logger_1 = require("../utils/logger");
admin.initializeApp();
const WEBHOOK_SECRET = (process.env.REVENUECAT_WEBHOOK_SECRET || '').trim();
const PREMIUM_USER_COLLECTION = 'premiumusers';
const PREMIUM_LOGS_COLLECTION = 'premiumusers_logs';
const hashValue = (value) => {
    if (value === undefined || value === null) {
        return null;
    }
    const normalized = typeof value === 'string' ? value : JSON.stringify(value);
    return (0, crypto_1.createHash)('sha256').update(normalized).digest('hex');
};
const determinePremiumStatus = (productIdentifier) => {
    var _a;
    const normalized = (_a = productIdentifier === null || productIdentifier === void 0 ? void 0 : productIdentifier.toLowerCase()) !== null && _a !== void 0 ? _a : '';
    if (!normalized) {
        return null;
    }
    if (normalized.includes('lifetime')) {
        return 'lifetime';
    }
    if (normalized.includes('yearly') ||
        normalized.includes('annual') ||
        normalized.includes('year') ||
        normalized.includes('12')) {
        return 'annual';
    }
    if (normalized.includes('monthly') || normalized.includes('month') || normalized.includes('30')) {
        return 'monthly';
    }
    return 'unknown';
};
const determineStore = (subscriber, productId) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const attributeStore = (_d = (_c = (_b = (_a = subscriber === null || subscriber === void 0 ? void 0 : subscriber.attributes) === null || _a === void 0 ? void 0 : _a.store) === null || _b === void 0 ? void 0 : _b.value) === null || _c === void 0 ? void 0 : _c.toLowerCase) === null || _d === void 0 ? void 0 : _d.call(_c);
    const subscriptionStore = productId && ((_h = (_g = (_f = (_e = subscriber === null || subscriber === void 0 ? void 0 : subscriber.subscriptions) === null || _e === void 0 ? void 0 : _e[productId]) === null || _f === void 0 ? void 0 : _f.store) === null || _g === void 0 ? void 0 : _g.toLowerCase) === null || _h === void 0 ? void 0 : _h.call(_g));
    const store = attributeStore || subscriptionStore || '';
    if (store.includes('google') || store.includes('play')) {
        return 'google_play';
    }
    if (store.includes('apple') || store.includes('app_store') || store.includes('appstore')) {
        return 'app_store';
    }
    if (store.includes('stripe')) {
        return 'stripe';
    }
    return 'unknown';
};
const normalizeEnvironment = (value) => {
    const normalized = (value || '').toLowerCase();
    if (normalized === 'production' || normalized === 'prod' || normalized === 'live') {
        return 'production';
    }
    if (normalized === 'sandbox' || normalized === 'test') {
        return 'sandbox';
    }
    return 'unknown';
};
const getExpiresDate = (entitlement, webhookEvent) => {
    if (entitlement === null || entitlement === void 0 ? void 0 : entitlement.expires_date) {
        return entitlement.expires_date;
    }
    if (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.expiration_at_ms) {
        return new Date(Number(webhookEvent.expiration_at_ms)).toISOString();
    }
    if (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.expires_date) {
        return webhookEvent.expires_date;
    }
    return null;
};
const deriveTransactionMeta = (subscriber, webhookEvent, productId) => {
    var _a;
    const subscription = productId ? (_a = subscriber === null || subscriber === void 0 ? void 0 : subscriber.subscriptions) === null || _a === void 0 ? void 0 : _a[productId] : null;
    const entTransaction = (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.transaction_id) || (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.transactionId);
    const originalTransaction = (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.original_transaction_id) ||
        (subscription === null || subscription === void 0 ? void 0 : subscription.original_purchase_transaction_id) ||
        (subscriber === null || subscriber === void 0 ? void 0 : subscriber.first_seen_transaction_id) ||
        null;
    return {
        transactionId: entTransaction || (subscription === null || subscription === void 0 ? void 0 : subscription.transaction_id) || null,
        originalTransactionId: originalTransaction || null,
    };
};
const applyEventMutations = (eventType, updates, context, previousState) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
    switch (eventType) {
        case 'INITIAL_PURCHASE':
            updates.premium = true;
            updates.premiumStartedAt = (_a = updates.premiumStartedAt) !== null && _a !== void 0 ? _a : context.nowISO;
            updates.premiumExpiresAt = context.expiresAt;
            updates.premiumStatus = (_c = (_b = context.derivedStatus) !== null && _b !== void 0 ? _b : updates.premiumStatus) !== null && _c !== void 0 ? _c : 'unknown';
            updates.isCancelled = false;
            updates.willCancelAtPeriodEnd = false;
            updates.billingIssue = false;
            updates.billingIssueDetectedAt = null;
            updates.billingRecoveredAt = null;
            break;
        case 'RENEWAL':
            updates.premium = true;
            updates.premiumLastRenewedAt = context.nowISO;
            updates.premiumExpiresAt = context.expiresAt;
            updates.billingIssue = false;
            updates.billingIssueDetectedAt = null;
            updates.billingRecoveredAt = null;
            break;
        case 'EXPIRATION':
            updates.premium = false;
            updates.premiumExpiresAt = null;
            updates.premiumEndedAt = context.nowISO;
            updates.isCancelled = true;
            updates.willCancelAtPeriodEnd = false;
            updates.cancellationEffectiveDate =
                (_f = (_e = (_d = previousState === null || previousState === void 0 ? void 0 : previousState.premiumExpiresAt) !== null && _d !== void 0 ? _d : context.expiresAt) !== null && _e !== void 0 ? _e : updates.cancellationEffectiveDate) !== null && _f !== void 0 ? _f : null;
            updates.billingIssue = false;
            updates.billingIssueDetectedAt = null;
            break;
        case 'GRACE_PERIOD_EXPIRED':
            updates.premium = false;
            updates.premiumEndedAt = context.nowISO;
            updates.premiumExpiresAt = null;
            updates.billingIssue = true;
            updates.billingIssueReason = 'GRACE_PERIOD_EXPIRED';
            break;
        case 'BILLING_ISSUE':
            updates.billingIssue = true;
            updates.billingIssueDetectedAt = context.nowISO;
            updates.billingIssueReason = 'BILLING_ISSUE';
            break;
        case 'BILLING_RECOVERY':
            updates.billingIssue = false;
            updates.billingRecoveredAt = context.nowISO;
            updates.billingIssueReason = null;
            break;
        case 'CANCELLATION':
            updates.isCancelled = true;
            updates.willCancelAtPeriodEnd = true;
            updates.cancellationEffectiveDate = context.expiresAt;
            break;
        case 'UNCANCELLATION':
            updates.isCancelled = false;
            updates.willCancelAtPeriodEnd = false;
            updates.cancellationEffectiveDate = null;
            break;
        case 'PRODUCT_CHANGE':
            updates.premium = true;
            updates.premiumStatus = (_h = (_g = context.derivedStatus) !== null && _g !== void 0 ? _g : updates.premiumStatus) !== null && _h !== void 0 ? _h : 'unknown';
            updates.premiumExpiresAt = context.expiresAt;
            updates.productId = (_l = (_k = (_j = context.entitlement) === null || _j === void 0 ? void 0 : _j.product_identifier) !== null && _k !== void 0 ? _k : updates.productId) !== null && _l !== void 0 ? _l : null;
            break;
        case 'ENTITLEMENT_GRANT':
        case 'IN_APP_PURCHASE':
        case 'NON_RENEWING_PURCHASE':
        case 'PROMOTIONAL_OFFER_REDEEMED':
            updates.premium = true;
            updates.premiumStatus = (_o = (_m = context.derivedStatus) !== null && _m !== void 0 ? _m : updates.premiumStatus) !== null && _o !== void 0 ? _o : 'unknown';
            updates.premiumExpiresAt = context.expiresAt;
            updates.premiumStartedAt = (_p = updates.premiumStartedAt) !== null && _p !== void 0 ? _p : context.nowISO;
            break;
        case 'TRANSFER':
            if ((_q = context.entitlement) === null || _q === void 0 ? void 0 : _q.is_active) {
                updates.premium = true;
                updates.premiumExpiresAt = context.expiresAt;
                updates.premiumEndedAt = null;
            }
            else {
                updates.premium = false;
                updates.premiumExpiresAt = null;
                updates.premiumEndedAt = context.nowISO;
            }
            break;
        case 'ENTITLEMENT_REVOKE':
            updates.premium = false;
            updates.premiumExpiresAt = null;
            updates.premiumEndedAt = context.nowISO;
            break;
        case 'SUBSCRIBER_ALIAS_CHANGED':
            // no premium change, but keep alias metadata
            break;
        default:
            if (context.entitlement) {
                updates.premium = context.entitlement.is_active === true;
                updates.premiumExpiresAt = context.entitlement.is_active ? context.expiresAt : null;
            }
            break;
    }
};
const revenuecatWebhook = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }
    if (!WEBHOOK_SECRET) {
        logger_1.logger.error('RevenueCat webhook authorization secret missing in environment');
        res.status(500).send('Webhook authorization not configured');
        return;
    }
    const incomingAuthHeader = (req.get('Authorization') || '').trim();
    if (!incomingAuthHeader) {
        logger_1.logger.warn('RevenueCat webhook missing Authorization header');
        res.status(401).send('Missing authorization header');
        return;
    }
    if (incomingAuthHeader !== WEBHOOK_SECRET) {
        logger_1.logger.warn('RevenueCat webhook authorization header mismatch');
        res.status(401).send('Invalid authorization header');
        return;
    }
    const eventBody = (req.body || {});
    try {
        const webhookEvent = eventBody.event || {};
        const subscriber = eventBody.subscriber || webhookEvent.subscriber || {};
        const eventTypeName = (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.type) || 'UNKNOWN';
        const nowISO = new Date().toISOString();
        const firebaseUserId = (_c = (_b = (_a = subscriber === null || subscriber === void 0 ? void 0 : subscriber.attributes) === null || _a === void 0 ? void 0 : _a.firebaseUserId) === null || _b === void 0 ? void 0 : _b.value) !== null && _c !== void 0 ? _c : null;
        const appUserEmailAttr = ((_e = (_d = subscriber === null || subscriber === void 0 ? void 0 : subscriber.attributes) === null || _d === void 0 ? void 0 : _d.appUserEmail) === null || _e === void 0 ? void 0 : _e.value) ||
            ((_g = (_f = subscriber === null || subscriber === void 0 ? void 0 : subscriber.attributes) === null || _f === void 0 ? void 0 : _f.email) === null || _g === void 0 ? void 0 : _g.value) ||
            null;
        const rcAppUserIdRaw = (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.app_user_id) ||
            (subscriber === null || subscriber === void 0 ? void 0 : subscriber.app_user_id) ||
            (eventBody === null || eventBody === void 0 ? void 0 : eventBody.app_user_id) ||
            null;
        const originalAppUserId = (subscriber === null || subscriber === void 0 ? void 0 : subscriber.original_app_user_id) ||
            (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.original_app_user_id) ||
            (eventBody === null || eventBody === void 0 ? void 0 : eventBody.original_app_user_id) ||
            null;
        const normalizeEmail = (value) => {
            if (!value || typeof value !== 'string') {
                return null;
            }
            const trimmed = value.trim();
            if (!trimmed || !trimmed.includes('@')) {
                return null;
            }
            return trimmed.toLowerCase();
        };
        const isAnonymousId = (value) => typeof value === 'string' && value.startsWith('RCAnonymousID:');
        const rcAppUserEmailCandidate = !isAnonymousId(rcAppUserIdRaw) ? normalizeEmail(rcAppUserIdRaw) : null;
        const emailCandidate = normalizeEmail(appUserEmailAttr) || rcAppUserEmailCandidate;
        let userId = firebaseUserId !== null && firebaseUserId !== void 0 ? firebaseUserId : null;
        if (!userId && emailCandidate) {
            try {
                const userRecord = await admin.auth().getUserByEmail(emailCandidate);
                userId = userRecord.uid;
            }
            catch (lookupError) {
                logger_1.logger.warn('RevenueCat webhook failed to map email to Firebase UID', {
                    emailCandidate,
                    lookupError,
                });
            }
        }
        if (!userId) {
            logger_1.logger.warn('RevenueCat webhook missing resolvable user id', {
                firebaseUserIdPresent: !!firebaseUserId,
                emailCandidate,
                rcAppUserId: rcAppUserIdRaw,
                originalAppUserId,
            });
            res.status(400).send('Missing user ID in payload');
            return;
        }
        let entitlement = (_j = (_h = subscriber === null || subscriber === void 0 ? void 0 : subscriber.entitlements) === null || _h === void 0 ? void 0 : _h.premium) !== null && _j !== void 0 ? _j : null;
        if (!entitlement && eventTypeName === 'TEST' && (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.product_id)) {
            entitlement = {
                product_identifier: webhookEvent.product_id,
                is_active: true,
                expires_date: (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.expiration_at_ms)
                    ? new Date(Number(webhookEvent.expiration_at_ms)).toISOString()
                    : null,
                environment: ((_k = webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.environment) === null || _k === void 0 ? void 0 : _k.toLowerCase()) || null,
            };
        }
        const productIdentifier = (entitlement === null || entitlement === void 0 ? void 0 : entitlement.product_identifier) ||
            (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.product_id) ||
            (subscriber === null || subscriber === void 0 ? void 0 : subscriber.last_seen_product_identifier) ||
            null;
        const expiresAt = getExpiresDate(entitlement, webhookEvent);
        const derivedStatus = determinePremiumStatus(productIdentifier);
        const environment = normalizeEnvironment((webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.environment) || (entitlement === null || entitlement === void 0 ? void 0 : entitlement.environment) || (subscriber === null || subscriber === void 0 ? void 0 : subscriber.environment));
        const store = determineStore(subscriber, productIdentifier);
        const { transactionId, originalTransactionId } = deriveTransactionMeta(subscriber, webhookEvent, productIdentifier);
        const eventId = (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.id) || (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.event_id) || (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.transaction_id) || null;
        const requestId = (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.event_id) || (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.request_id) || null;
        const alias = (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.subscriber_alias) || (subscriber === null || subscriber === void 0 ? void 0 : subscriber.subscriber_alias) || null;
        const premiumUsersRef = admin.firestore().collection(PREMIUM_USER_COLLECTION).doc(userId);
        let duplicateDetected = false;
        let finalUpdates = null;
        let basePremiumValue = false;
        await admin.firestore().runTransaction(async (transaction) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10;
            const existingSnapshot = await transaction.get(premiumUsersRef);
            const existingData = (existingSnapshot.exists ? existingSnapshot.data() : null) || null;
            if ((existingData === null || existingData === void 0 ? void 0 : existingData.lastPremiumDecisionId) && existingData.lastPremiumDecisionId === eventId) {
                duplicateDetected = true;
                return;
            }
            basePremiumValue = (_a = existingData === null || existingData === void 0 ? void 0 : existingData.premium) !== null && _a !== void 0 ? _a : false;
            const updates = {
                uid: userId,
                premium: basePremiumValue,
                premiumStatus: (_c = (_b = existingData === null || existingData === void 0 ? void 0 : existingData.premiumStatus) !== null && _b !== void 0 ? _b : derivedStatus) !== null && _c !== void 0 ? _c : null,
                premiumExpiresAt: (_d = existingData === null || existingData === void 0 ? void 0 : existingData.premiumExpiresAt) !== null && _d !== void 0 ? _d : null,
                premiumStartedAt: (_e = existingData === null || existingData === void 0 ? void 0 : existingData.premiumStartedAt) !== null && _e !== void 0 ? _e : null,
                premiumLastRenewedAt: (_f = existingData === null || existingData === void 0 ? void 0 : existingData.premiumLastRenewedAt) !== null && _f !== void 0 ? _f : null,
                premiumEndedAt: (_g = existingData === null || existingData === void 0 ? void 0 : existingData.premiumEndedAt) !== null && _g !== void 0 ? _g : null,
                isCancelled: (_h = existingData === null || existingData === void 0 ? void 0 : existingData.isCancelled) !== null && _h !== void 0 ? _h : false,
                willCancelAtPeriodEnd: (_j = existingData === null || existingData === void 0 ? void 0 : existingData.willCancelAtPeriodEnd) !== null && _j !== void 0 ? _j : false,
                cancellationEffectiveDate: (_k = existingData === null || existingData === void 0 ? void 0 : existingData.cancellationEffectiveDate) !== null && _k !== void 0 ? _k : null,
                billingIssue: (_l = existingData === null || existingData === void 0 ? void 0 : existingData.billingIssue) !== null && _l !== void 0 ? _l : false,
                billingIssueDetectedAt: (_m = existingData === null || existingData === void 0 ? void 0 : existingData.billingIssueDetectedAt) !== null && _m !== void 0 ? _m : null,
                billingRecoveredAt: (_o = existingData === null || existingData === void 0 ? void 0 : existingData.billingRecoveredAt) !== null && _o !== void 0 ? _o : null,
                store,
                productId: (_p = productIdentifier !== null && productIdentifier !== void 0 ? productIdentifier : existingData === null || existingData === void 0 ? void 0 : existingData.productId) !== null && _p !== void 0 ? _p : null,
                entitlementId: entitlement ? 'premium' : (_q = existingData === null || existingData === void 0 ? void 0 : existingData.entitlementId) !== null && _q !== void 0 ? _q : null,
                transactionId: (_r = transactionId !== null && transactionId !== void 0 ? transactionId : existingData === null || existingData === void 0 ? void 0 : existingData.transactionId) !== null && _r !== void 0 ? _r : null,
                originalTransactionId: (_s = originalTransactionId !== null && originalTransactionId !== void 0 ? originalTransactionId : existingData === null || existingData === void 0 ? void 0 : existingData.originalTransactionId) !== null && _s !== void 0 ? _s : null,
                transactionIdHash: (_u = (_t = hashValue(transactionId)) !== null && _t !== void 0 ? _t : existingData === null || existingData === void 0 ? void 0 : existingData.transactionIdHash) !== null && _u !== void 0 ? _u : null,
                receiptHash: (_w = (_v = hashValue(webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.receipt)) !== null && _v !== void 0 ? _v : existingData === null || existingData === void 0 ? void 0 : existingData.receiptHash) !== null && _w !== void 0 ? _w : null,
                environment,
                lastPremiumEventType: eventTypeName,
                lastPremiumDecisionId: eventId,
                lastPremiumDecisionOrigin: 'revenuecat_webhook',
                lastPremiumWebhookAt: nowISO,
                lastPremiumDecisionSource: 'revenuecat_webhook',
                lastPremiumDecisionPlatform: (_0 = (_z = (_y = (_x = subscriber === null || subscriber === void 0 ? void 0 : subscriber.attributes) === null || _x === void 0 ? void 0 : _x.platform) === null || _y === void 0 ? void 0 : _y.value) !== null && _z !== void 0 ? _z : existingData === null || existingData === void 0 ? void 0 : existingData.lastPremiumDecisionPlatform) !== null && _0 !== void 0 ? _0 : null,
                lastPremiumDecisionRequestId: requestId,
                lastPremiumDecisionTriggeredBy: 'revenuecat',
                lastPremiumVerifiedAt: nowISO,
                updatedAt: nowISO,
                lastRawEvent: webhookEvent,
                originalAppUserId: originalAppUserId || (existingData === null || existingData === void 0 ? void 0 : existingData.originalAppUserId) || null,
                storeCountry: ((_2 = (_1 = subscriber === null || subscriber === void 0 ? void 0 : subscriber.attributes) === null || _1 === void 0 ? void 0 : _1.storeCountry) === null || _2 === void 0 ? void 0 : _2.value) ||
                    (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.store_country) ||
                    (existingData === null || existingData === void 0 ? void 0 : existingData.storeCountry) ||
                    null,
                deviceId: ((_4 = (_3 = subscriber === null || subscriber === void 0 ? void 0 : subscriber.attributes) === null || _3 === void 0 ? void 0 : _3.deviceId) === null || _4 === void 0 ? void 0 : _4.value) || (existingData === null || existingData === void 0 ? void 0 : existingData.deviceId) || null,
                ipAddress: (webhookEvent === null || webhookEvent === void 0 ? void 0 : webhookEvent.ip_address) || (existingData === null || existingData === void 0 ? void 0 : existingData.ipAddress) || null,
                alias: alias || (existingData === null || existingData === void 0 ? void 0 : existingData.alias) || null,
                billingIssueReason: (_5 = existingData === null || existingData === void 0 ? void 0 : existingData.billingIssueReason) !== null && _5 !== void 0 ? _5 : null,
                premiumSource: 'revenuecat',
                lastSyncedSource: 'revenuecat_webhook',
                lastSyncedOrigin: 'webhook',
                lastSyncedPlatform: (_9 = (_8 = (_7 = (_6 = subscriber === null || subscriber === void 0 ? void 0 : subscriber.attributes) === null || _6 === void 0 ? void 0 : _6.platform) === null || _7 === void 0 ? void 0 : _7.value) !== null && _8 !== void 0 ? _8 : existingData === null || existingData === void 0 ? void 0 : existingData.lastSyncedPlatform) !== null && _9 !== void 0 ? _9 : null,
                createdAt: (_10 = existingData === null || existingData === void 0 ? void 0 : existingData.createdAt) !== null && _10 !== void 0 ? _10 : nowISO,
            };
            applyEventMutations(eventTypeName, updates, {
                nowISO,
                expiresAt,
                derivedStatus,
                entitlement,
            }, existingData);
            if (!updates.premiumStatus && derivedStatus) {
                updates.premiumStatus = derivedStatus;
            }
            if (updates.premium && !updates.premiumExpiresAt && expiresAt) {
                updates.premiumExpiresAt = expiresAt;
            }
            transaction.set(premiumUsersRef, updates, { merge: true });
            finalUpdates = updates;
        });
        if (duplicateDetected) {
            logger_1.logger.info('RevenueCat webhook ignored duplicate event (transaction safe)', {
                userId,
                eventId,
                eventTypeName,
            });
            res.status(200).send('Duplicate ignored');
            return;
        }
        if (!finalUpdates) {
            throw new Error('RevenueCat webhook transaction failed to produce updates');
        }
        const resolvedUpdates = finalUpdates;
        const premiumAfter = resolvedUpdates.premium;
        const logEntry = {
            logId: `${userId}_${Date.now()}_${eventId !== null && eventId !== void 0 ? eventId : 'noevent'}`,
            userId,
            eventType: eventTypeName,
            premiumBefore: basePremiumValue,
            premiumAfter,
            timestamp: nowISO,
            environment,
            store,
            productId: (_l = resolvedUpdates.productId) !== null && _l !== void 0 ? _l : null,
            decisionId: eventId,
            requestId,
            rawEvent: webhookEvent,
        };
        await admin.firestore().collection(PREMIUM_LOGS_COLLECTION).doc(logEntry.logId).set(logEntry);
        logger_1.logger.info('RevenueCat webhook processed successfully', {
            userId,
            event: eventTypeName,
            premium: resolvedUpdates.premium,
            premiumStatus: resolvedUpdates.premiumStatus,
            store,
            environment,
        });
        res.status(200).send('Success');
    }
    catch (error) {
        logger_1.logger.error('Webhook processing error', { error });
        res.status(500).send('Internal Server Error');
    }
});
exports.revenuecatWebhook = revenuecatWebhook;
