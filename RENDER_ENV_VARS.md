# Render.com Environment Variables

Bu dosya, Render.com'da production deployment için gerekli environment variables'ları içerir.

## 🔧 Render.com'da Ayarlanacak Environment Variables

### 1. Server Configuration
```
NODE_ENV=production
PORT=4000
LOG_LEVEL=warn
```

### 2. CORS Configuration
```
CORS_ORIGIN=https://yourdomain.com,https://app.yourdomain.com
```

### 3. JWT Configuration
```
JWT_ISS=chatgbtmini
JWT_AUD=chatgbtmini-mobile
JWT_HS_SECRET=your-super-secret-jwt-key-256-bit-random-string
JWT_ACCESS_TTL_MIN=15
```

### 4. Refresh Token Configuration
```
REFRESH_TTL_DAYS=60
```

### 5. Redis Configuration
```
REDIS_URL=redis://your-redis-host:6379
```

### 6. Firebase Configuration
```
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
```

### 7. Google OAuth Configuration (Opsiyonel)
```
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://your-render-app.onrender.com/auth/google/callback
```

### 8. Security Configuration
```
MAX_FAILED_ATTEMPTS=5
LOCKOUT_DURATION_MINUTES=30
PASSWORD_RESET_TTL_HOURS=1
```

### 9. Email Configuration (Opsiyonel - Password Reset için)
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@yourdomain.com
```

## 🚀 Render.com Deployment Adımları

### 1. Render.com'da Yeni Web Service Oluştur
- **Build Command**: `npm ci --include=dev && npm run build`
- **Start Command**: `npm start`
- **Node Version**: `18`

### 2. Environment Variables Ekle
Yukarıdaki tüm environment variables'ları Render.com dashboard'unda ekle.

### 3. Firebase Service Account Oluştur
1. Firebase Console → Project Settings → Service Accounts
2. "Generate new private key" tıkla
3. JSON dosyasını indir
4. `FIREBASE_PRIVATE_KEY` olarak ekle (tüm içeriği)

### 4. Redis Service Ekle
- Render.com'da Redis service oluştur
- Connection URL'i `REDIS_URL` olarak ekle

## 🔐 Güvenlik Notları

### JWT Secret
```bash
# Güçlü JWT secret oluştur
openssl rand -base64 32
```

### Firebase Private Key
- Private key'i tam olarak kopyala (başlangıç ve bitiş satırları dahil)
- `\n` karakterlerini koru
- Tırnak işaretleri içinde ekle

### CORS Origins
- Sadece güvenilir domain'leri ekle
- Wildcard (*) kullanma
- HTTPS kullan

## 📊 Monitoring

### Health Check
```
GET https://your-render-app.onrender.com/health
```

### API Documentation
```
https://your-render-app.onrender.com/docs
```

## 🔄 Deployment Checklist

- [ ] Environment variables eklendi
- [ ] Firebase service account oluşturuldu
- [ ] Redis service eklendi
- [ ] CORS origins güvenli
- [ ] JWT secret güçlü
- [ ] Build command doğru
- [ ] Start command doğru
- [ ] Node version 18
- [ ] Health check çalışıyor
- [ ] API endpoints test edildi

## 🚨 Troubleshooting

### Common Issues

#### Build Failures
```bash
# Local'de test et
npm run build
```

#### Environment Variable Issues
```bash
# Tüm env vars'ları kontrol et
echo $NODE_ENV
echo $PORT
echo $FIREBASE_PROJECT_ID
```

#### Firebase Connection Issues
```bash
# Firebase credentials'ları kontrol et
# Private key format'ını kontrol et
# Project ID'yi kontrol et
```

#### Redis Connection Issues
```bash
# Redis URL'ini kontrol et
# Redis service'in çalıştığını kontrol et
```

## 📞 Support

- **Render.com Docs**: https://render.com/docs
- **Firebase Docs**: https://firebase.google.com/docs
- **Redis Docs**: https://redis.io/documentation
