# 이미래 인천 (Imirae Incheon)

Monorepo for **아가잼잼** — a Korean baby care service management platform with back office, mobile admin, and native apps.

## Repository Structure

```
dev/
├── backend/        # NestJS API server (imirae-incheon-backend)
├── frontend/       # Next.js desktop back office (imirae-incheon-back-office)
├── mobile/         # Next.js mobile admin PWA (babyjamjam-admin)
├── native/         # Kotlin Multiplatform (Android + iOS)
├── docs/           # Documentation, guides, and task tracking
└── .github/        # CI/CD workflows
```

## Applications

### Backend (`/backend`)

REST API server powering all client applications.

| | |
|---|---|
| Framework | NestJS |
| Language | TypeScript |
| Database | PostgreSQL via Prisma ORM |
| Auth | JWT + Kakao OAuth |
| Notifications | Web Push (VAPID) + AlimTalk (Aligo/ChannelTalk) |
| Package Manager | pnpm |

```bash
cd backend
pnpm install
pnpm start:dev       # Development (watch mode)
pnpm build           # Production build
pnpm test            # Run tests
```

### Frontend (`/frontend`)

Desktop back office for administrative management.

| | |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS v4 + shadcn/ui |
| State | Zustand + TanStack React Query v5 |
| Package Manager | pnpm |

```bash
cd frontend
pnpm install
pnpm dev             # http://localhost:3001
pnpm build           # Production build
pnpm test            # Run tests
```

### Mobile (`/mobile`)

Mobile-first admin PWA for field staff and managers. See [`mobile/README.md`](mobile/README.md) for detailed architecture.

| | |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS v4 + V3 Design System |
| Design | 393x852 (iPhone 15 Pro) viewport |
| Package Manager | pnpm |

```bash
cd mobile
pnpm install
pnpm dev             # http://localhost:3000
pnpm build           # Production build
pnpm test            # Run tests
```

### Native (`/native`)

Kotlin Multiplatform app targeting Android and iOS. See [`native/SETUP.md`](native/SETUP.md) for build instructions.

| | |
|---|---|
| Framework | Kotlin Multiplatform (KMP) |
| Android UI | Jetpack Compose |
| iOS UI | SwiftUI |
| Shared | Kotlin shared module (auth, networking, viewmodels) |

```bash
cd native
./gradlew androidApp:installDebug   # Android
# iOS: open iosApp/ in Xcode
```

## Tech Stack Overview

```
                  ┌─────────────┐
                  │   Backend    │
                  │   NestJS     │
                  │  PostgreSQL  │
                  └──────┬──────┘
                         │ REST API
          ┌──────────────┼──────────────┐
          │              │              │
   ┌──────┴──────┐ ┌────┴─────┐ ┌──────┴──────┐
   │  Frontend   │ │  Mobile  │ │   Native    │
   │  Next.js    │ │  Next.js │ │    KMP      │
   │  Desktop    │ │  PWA     │ │ Android/iOS │
   └─────────────┘ └──────────┘ └─────────────┘
```

## Prerequisites

- **Node.js** >= 20
- **pnpm** (enforced via `preinstall` scripts)
- **Java 17** (for native builds only)
- **PostgreSQL** (for backend)

## Documentation

- [`docs/conventions/`](docs/conventions/) — Code conventions
- [`docs/blog-posts/`](docs/blog-posts/) — Technical blog posts
- [`docs/tasks/`](docs/tasks/) — Task tracking
- [`docs/PWA_PUSH_NOTIFICATION_GUIDE.md`](docs/PWA_PUSH_NOTIFICATION_GUIDE.md) — Push notification setup
- [`native/SETUP.md`](native/SETUP.md) — Native app build guide
