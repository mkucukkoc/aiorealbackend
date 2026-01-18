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
admin.initializeApp();
const db = admin.firestore();
// RevenueCat webhook endpoint
exports.revenuecatWebhook = functions.https.onRequest(async (req, res) => {
    try {
        const event = req.body;
        // örnek loglama
        console.log("📩 RevenueCat webhook received:", event);
        const { event: eventType, subscriber, app_user_id } = event;
        // Firebase'de kullanıcıya ait abonelik bilgilerini güncelle
        if (app_user_id) {
            const userRef = db.collection('users').doc(app_user_id);
            await userRef.set({
                subscription: {
                    eventType,
                    subscriber,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                },
            }, { merge: true });
        }
        res.status(200).send('✅ Webhook processed successfully');
    }
    catch (error) {
        console.error("❌ Webhook processing failed:", error);
        res.status(500).send('❌ Webhook error');
    }
});


