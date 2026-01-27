# PWA Push Notification Implementation Guide

This document describes the PWA push notification system implemented for the Imirae Incheon Back Office project.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        PWA PUSH FLOW                            │
└─────────────────────────────────────────────────────────────────┘

1. SUBSCRIPTION (One-time setup)
   ┌──────────┐    Subscribe     ┌──────────────────┐
   │  Browser │ ─────────────▶  │  Push Service     │
   │  (User)  │ ◀───────────── │  (FCM/Mozilla/APNs)│
   └──────────┘  PushSubscription└──────────────────┘
        │              │
        │              ▼
        │         {endpoint, keys}
        │              │
        ▼              ▼
   ┌──────────────────────────────┐
   │       Your Backend          │
   │   (Store subscription)       │
   └──────────────────────────────┘

2. SENDING NOTIFICATION
   ┌──────────────┐  Web Push API   ┌──────────────────┐
   │ Your Backend │ ──────────────▶ │   Push Service   │
   │  (NestJS)    │   (encrypted)   │  (Google/Mozilla)│
   └──────────────┘                 └────────┬─────────┘
                                             │
                                             ▼
                                    ┌──────────────┐
                                    │   Browser    │
                                    │ (Shows toast)│
                                    └──────────────┘
```

## Key Components

| Component | Role |
|-----------|------|
| **Service Worker** | Background script in browser that receives push events |
| **Push Subscription** | Contains endpoint URL + encryption keys for the device |
| **Push Service** | Browser vendor's server (FCM, Mozilla, APNs) |
| **VAPID Keys** | Your server's identity (public/private key pair) |
| **web-push library** | Node.js library to send encrypted push messages |

## Platform Support

| Platform | Support | Notes |
|----------|---------|-------|
| **Chrome (Android)** | ✅ Full | Works great |
| **Chrome (Desktop)** | ✅ Full | Works great |
| **Firefox** | ✅ Full | Works great |
| **Edge** | ✅ Full | Works great |
| **Safari (macOS)** | ✅ Since 16.4 | Requires HTTPS |
| **Safari (iOS)** | ⚠️ Limited | **Only works if user adds PWA to Home Screen** |
| **Samsung Internet** | ✅ Full | Works great |

> **iOS Limitation**: Safari on iOS only supports push notifications when the PWA is **added to the Home Screen**. Regular Safari browser tabs cannot receive push notifications.

---

## Files Structure

### Backend (NestJS)

```
backend/
├── prisma/schema.prisma           # Database schema with push_subscription & notification tables
├── domain/
│   ├── entities/
│   │   ├── push-subscription.entity.ts    # Push subscription domain entity
│   │   └── notification.entity.ts         # Notification domain entity
│   ├── repositories/
│   │   ├── push-subscription.repository.interface.ts  # Repository port
│   │   └── notification.repository.interface.ts       # Repository port
│   └── ports/
│       └── web-push.port.ts               # Web Push service port
├── infrastructure/
│   ├── database/
│   │   ├── mapper/
│   │   │   ├── push-subscription.mapper.ts
│   │   │   └── notification.mapper.ts
│   │   └── repositories/
│   │       ├── sb.push-subscription.repository.ts     # Prisma implementation
│   │       └── sb.notification.repository.ts          # Prisma implementation
│   └── api/
│       └── web-push.adapter.ts            # web-push library adapter
├── application/
│   ├── usecases/notification/
│   │   ├── subscribe-push.usecase.ts      # Handle push subscription
│   │   ├── unsubscribe-push.usecase.ts    # Handle unsubscription
│   │   ├── send-notification.usecase.ts   # Send to user/broadcast
│   │   ├── get-notifications.usecase.ts   # Fetch notifications
│   │   ├── mark-notification-read.usecase.ts
│   │   ├── get-vapid-key.usecase.ts
│   │   └── index.ts
│   └── services/
│       └── notification.service.ts        # Application service
├── interface/
│   ├── dto/notification.dto.ts            # Request/Response DTOs
│   └── controllers/notification.controller.ts
├── module/notification.module.ts          # NestJS module with DI config
└── app.module.ts                          # Updated to import NotificationModule
```

### Frontend (Next.js)

```
frontend/
├── public/
│   ├── sw.js                              # Service Worker for push events
│   └── manifest.json                      # PWA manifest
└── src/app/
    ├── layout.tsx                         # Updated with PWA meta tags
    ├── hooks/
    │   ├── usePushNotification.ts         # Main push notification hook
    │   └── index.ts                       # Updated exports
    └── (components)/notifications/
        ├── NotificationSettings.tsx       # Settings toggle component
        ├── NotificationBell.tsx           # Header bell with badge
        └── index.ts
```

---

## Setup Steps

### 1. Install Dependencies

```bash
cd backend
npm install web-push
npm install -D @types/web-push
```

### 2. Generate VAPID Keys

```bash
npx web-push generate-vapid-keys
```

This outputs something like:
```
Public Key:
BNxXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

Private Key:
XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### 3. Configure Environment Variables

Add to `backend/.env`:

```env
# Web Push (VAPID)
VAPID_PUBLIC_KEY=BNxXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
VAPID_PRIVATE_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
VAPID_EMAIL=admin@your-domain.com
```

### 4. Run Database Migration

```bash
cd backend
npx prisma db push
# or for production:
npx prisma migrate dev --name add_push_notifications
```

### 5. Create PWA Icons

Create these icon files in `frontend/public/assets/`:

| File | Size | Purpose |
|------|------|---------|
| `icon-72.png` | 72x72 | Android legacy |
| `icon-96.png` | 96x96 | Android legacy |
| `icon-128.png` | 128x128 | Web app |
| `icon-144.png` | 144x144 | Windows tiles |
| `icon-152.png` | 152x152 | iOS |
| `icon-192.png` | 192x192 | Android/PWA |
| `icon-384.png` | 384x384 | High DPI |
| `icon-512.png` | 512x512 | Splash screens |
| `badge-72.png` | 72x72 | Notification badge (monochrome) |

### 6. Verify HTTPS

Push notifications require HTTPS in production. Ensure your deployment has:
- Valid SSL certificate
- HTTPS redirect enabled

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/notifications/vapid-key` | No | Get VAPID public key for subscription |
| POST | `/notifications/subscribe` | Yes | Subscribe browser to push |
| POST | `/notifications/unsubscribe` | Yes | Unsubscribe from push |
| GET | `/notifications` | Yes | Get user's notification history |
| GET | `/notifications/unread/count` | Yes | Get unread notification count |
| PATCH | `/notifications/:id/read` | Yes | Mark single notification as read |
| PATCH | `/notifications/read-all` | Yes | Mark all notifications as read |
| POST | `/notifications/send` | Yes* | Send notification to specific user |
| POST | `/notifications/broadcast` | Yes* | Broadcast to all subscribers |

> *Admin endpoints - consider adding role-based access control

---

## Usage Examples

### Frontend: Using the Hook

```tsx
import { usePushNotification, useUnreadCount } from '@/app/hooks';

function MyComponent() {
  const {
    isSupported,
    isSubscribed,
    permission,
    isLoading,
    subscribe,
    unsubscribe
  } = usePushNotification();

  const { data: unreadCount } = useUnreadCount();

  const handleToggle = async () => {
    if (isSubscribed) {
      await unsubscribe();
    } else {
      await subscribe();
    }
  };

  if (!isSupported) {
    return <p>Push notifications not supported</p>;
  }

  return (
    <div>
      <p>Unread: {unreadCount}</p>
      <button onClick={handleToggle} disabled={isLoading}>
        {isSubscribed ? 'Disable' : 'Enable'} Notifications
      </button>
    </div>
  );
}
```

### Frontend: Using Pre-built Components

```tsx
import { NotificationBell, NotificationSettings } from '@/app/(components)/notifications';

// In your header
function Header() {
  return (
    <header>
      <nav>...</nav>
      <NotificationBell />  {/* Shows bell icon with unread badge */}
    </header>
  );
}

// In your settings page
function SettingsPage() {
  return (
    <div>
      <h1>Settings</h1>
      <NotificationSettings />  {/* Toggle switch with status */}
    </div>
  );
}
```

### Backend: Sending Notifications

```typescript
// In any NestJS service or controller
import { NotificationService } from 'application/services/notification.service';

@Injectable()
export class ContractService {
  constructor(
    private notificationService: NotificationService,
  ) {}

  async onContractSigned(contract: Contract) {
    // Send notification to the contract owner
    await this.notificationService.sendNotification(
      contract.ownerId,
      '계약서 서명 완료',
      `${contract.clientName}님이 계약서에 서명했습니다.`,
      { url: `/contracts/${contract.id}` }
    );
  }

  async sendMaintenanceNotice() {
    // Broadcast to all users
    await this.notificationService.broadcastNotification(
      '시스템 점검 안내',
      '내일 오전 2시~4시 시스템 점검이 있습니다.',
      { url: '/announcements/maintenance' }
    );
  }
}
```

---

## Service Worker Details

The service worker (`public/sw.js`) handles:

1. **Push Events** - Receives and displays notifications
2. **Notification Clicks** - Opens URLs from notification data
3. **Lifecycle** - Auto-updates when new version deployed

### Push Payload Format

```json
{
  "title": "Notification Title",
  "body": "Notification body text",
  "icon": "/assets/icon-192.png",
  "badge": "/assets/badge-72.png",
  "data": {
    "url": "/path/to/open"
  }
}
```

---

## Database Schema

```prisma
model push_subscription {
  id         Int      @id @default(autoincrement())
  user_id    String   @db.Uuid
  endpoint   String   @unique
  p256dh_key String
  auth_key   String
  user_agent String?
  created_at DateTime @default(now()) @db.Timestamptz(6)
  user       user     @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@index([user_id])
}

model notification {
  id         Int       @id @default(autoincrement())
  user_id    String    @db.Uuid
  title      String
  body       String
  data       Json?
  sent_at    DateTime  @default(now()) @db.Timestamptz(6)
  read_at    DateTime? @db.Timestamptz(6)
  user       user      @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@index([user_id, sent_at])
}
```

---

## Troubleshooting

### Notifications not showing

1. **Check HTTPS**: Push requires HTTPS (localhost is exempt)
2. **Check permission**: `Notification.permission` should be `'granted'`
3. **Check subscription**: Browser DevTools > Application > Service Workers
4. **Check server logs**: Look for web-push errors (410 = expired subscription)

### iOS not receiving notifications

1. User must **add PWA to Home Screen** first
2. User must grant permission from the installed PWA
3. Safari 16.4+ required

### Subscription expires (410 Gone)

This is normal - subscriptions expire. The system automatically:
1. Detects 410/404 errors when sending
2. Removes invalid subscriptions from database
3. User can re-subscribe through the UI

### VAPID key mismatch

If you regenerate VAPID keys:
1. All existing subscriptions become invalid
2. Users must unsubscribe and re-subscribe
3. Clear old subscriptions from database

---

## Security Considerations

1. **VAPID Private Key**: Never expose in frontend or commit to git
2. **Subscription Endpoint**: Unique per browser - don't share between users
3. **Admin Endpoints**: Add role-based access control for `/send` and `/broadcast`
4. **Rate Limiting**: Consider adding rate limits to prevent notification spam

---

## Future Enhancements

- [ ] Add notification preferences (categories user can toggle)
- [ ] Add scheduled notifications
- [ ] Add notification templates
- [ ] Add analytics (delivery rate, open rate)
- [ ] Add admin dashboard for notification management
- [ ] Add webhook for notification delivery confirmation
