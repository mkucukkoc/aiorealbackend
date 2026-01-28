# AI or Real - Quota & Subscription Sistemi Dokümantasyonu

## 1) Mimari Özet (Tek Doğru Kaynak)

- **Tek doğru kaynak**: Backend Firestore’daki `subscriptions_quota` dokümanı. Bu doküman RevenueCat webhook’ları ile güncellenir.
- **RevenueCat entegrasyonu**:
  - Webhook (`/webhooks/revenuecat`) ana kaynak.
  - Client tarafı `customerInfo` sync sadece tamamlayıcı (ör. `syncPremiumCustomerInfo`).
  - Backend her request’te RevenueCat’e gitmez.
- **Quota mantığı**:
  - Her kullanıcı için aktif bir **wallet** açılır (`quota_wallets`).
  - Detect isteği geldiğinde: **reserve → AI çalıştır → commit/rollback**.
  - Idempotency: `request_id` aynı ise tekrar düşmez.

## 2) Veri Modeli (Firestore Koleksiyonları)

Aşağıdaki koleksiyonlar Firestore’da kullanılır:

### A) `subscriptions_quota`
- `id`: string (userId)
- `user_id`: string
- `platform`: string | null
- `rc_app_user_id`: string | null
- `product_id`: string | null
- `plan_id`: string | null
- `plan_key`: string | null
- `cycle`: `monthly | yearly | null`
- `entitlement_ids`: string[]
- `is_active`: boolean
- `will_renew`: boolean
- `status`: `active | cancelled | expired | refunded | billing_issue`
- `current_period_start`: string | null
- `current_period_end`: string | null
- `last_rc_event_at`: string | null
- `original_purchase_date`: string | null
- `updated_at`: string
- `created_at`: string

### B) `quota_wallets`
- `id`: string (**docId = userId**)
- `user_id`: string
- `subscription_id`: string | null
- `plan_id`: string | null
- `scope`: `monthly | yearly`
- `period_start`: string | null
- `period_end`: string | null
- `quota_total`: number
- `quota_used`: number
- `status`: `active | closed`
- `last_usage_at`: string | null
- `created_at`: string
- `updated_at`: string
- **history**: `quota_wallets/{userId}/wallet_history` alt koleksiyonu (kapanan wallet snapshotları)

### C) `quota_usages` (Audit Log)
- `id`: string (`${userId}_${requestId}`)
- `user_id`: string
- `wallet_id`: string
- `request_id`: string
- `action`: string (`ai_detect`)
- `amount`: number (default 1)
- `status`: `reserved | committed | rolled_back`
- `created_at`: string
- `updated_at`: string

### D) `webhook_events` (Idempotency)
- `id`: string (event id veya hash)
- `rc_event_id`: string
- `event_type`: string
- `rc_app_user_id`: string | null
- `received_at`: string
- `processed_at`: string | null
- `payload_json`: string
- `status`: `received | processed`

## 3) Planlar ve Quota Konfigürasyonu

Konfigürasyon `QUOTA_PLAN_CONFIG` env ile yönetilir. Varsayılan:

- `premium_monthly` → **100 detect** (monthly)
- `premium_yearly` → **1000 detect** (yearly)
- `free` → **2 detect** (monthly)

Örnek JSON:

```json
{
  "plans": [
    {
      "planId": "premium_monthly",
      "planKey": "base",
      "cycle": "monthly",
      "quota": 100,
      "productIds": ["ai_or_real_premium:aiorreal-monthly", "aiorreal-monthly"]
    },
    {
      "planId": "premium_yearly",
      "planKey": "pro",
      "cycle": "yearly",
      "quota": 1000,
      "productIds": ["ai_or_real_premium:aiorreal-yearly", "aiorreal-yearly"]
    }
  ]
}
```

## 4) Akışlar (Metinle Akış Diyagramı)

### 4.1 Detect Akışı
```
Client -> POST /api/v1/analysis/detect
        -> Backend Auth
        -> Quota reserve (request_id)
        -> AI detect
        -> success => commit
        -> fail => rollback
        -> response: verdict + remaining_quota + period_end + plan info
```

### 4.2 RevenueCat Webhook Akışı
```
RC -> POST /webhooks/revenuecat
   -> Authorization Secret doğrula
   -> event_id dedupe (webhook_events)
   -> premiumusers güncelle
   -> subscriptions_quota güncelle
   -> wallet aç/kapat
   -> response 200
```

### 4.3 Period Reset
- **Monthly**: yeni period geldiğinde eski wallet kapanır, yenisi açılır.
- **Yearly**: tek wallet, period bitince yenilenir.

## 5) Webhook Event Mapping

| Event | Etki |
|------|------|
| INITIAL_PURCHASE / RENEWAL / PRODUCT_CHANGE | subscription aktif, wallet aç/yenile |
| CANCELLATION | `will_renew=false`, premium devam |
| EXPIRATION | premium kapanır, wallet kapanır |
| REFUND / CHARGEBACK | premium anında kapanır, remaining=0 |
| BILLING_ISSUE / PAUSE | premium bloklanır (allow_usage=false), wallet kapanmaz |
| GRACE_PERIOD | allow_usage=true (period_end’e kadar) |
| TRANSFER | rc_app_user_id güncellenir |

## 6) Frontend Kullanımı

### 6.1 Quota Bilgisi
```
GET /api/v1/quota
Authorization: Bearer <firebase_jwt>

Response:
{
  "planId": "premium_monthly",
  "planKey": "base",
  "cycle": "monthly",
  "isActive": true,
  "willRenew": true,
  "periodStart": "2025-01-01T00:00:00.000Z",
  "periodEnd": "2025-02-01T00:00:00.000Z",
  "quotaTotal": 100,
  "quotaUsed": 12,
  "quotaRemaining": 88,
  "walletId": "..."
}
```

### 6.2 Detect İsteği (Recommended)
```
POST /api/v1/analysis/detect
Headers:
  Authorization: Bearer <firebase_jwt>
  x-request-id: <uuid>
Body:
  { "image": "..." }

Success Response:
{
  "success": true,
  "data": {
    "analysisId": "...",
    "result": { ... },
    "quota": {
      "quotaRemaining": 87,
      "periodEnd": "2025-02-01T00:00:00.000Z"
    }
  }
}
```

> Not: `POST /api/v1/quota/consume` endpointi kaldırıldı. Tüketim sadece `POST /api/v1/analysis/detect` içinde yapılır.

## 7) Edge Case Listesi + Test Senaryoları

1. **Monthly renew**: period_end geçtiğinde yeni wallet açılıyor mu?
2. **Yearly cancel**: willRenew=false → period_end’e kadar kullanım devam.
3. **Refund**: refund event → premium kapanır, remaining 0.
4. **Product change (monthly->yearly)**: monthly wallet kapanır, yearly açılır.
5. **Concurrent requests**: aynı anda 2 request → quota negatif olmamalı.
6. **Duplicated webhook**: aynı event id tekrar gelirse işlem yapılmamalı.

## 8) Güvenlik Notları

- Webhook secret doğrulaması zorunludur.
- `request_id` olmadan quota tüketimi yapılmaz.
- Client quota bilgisi sadece gösterimdir; karar backend’dedir.
- Rate limit (IP bazlı) + per-user idempotency abuse’u engeller.
