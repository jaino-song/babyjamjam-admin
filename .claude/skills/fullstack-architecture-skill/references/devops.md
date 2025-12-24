# DevOps Guide

## 환경 구성

```
┌─────────────────────────────────────────────────────────────┐
│                     Environment Strategy                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Local → Development → Staging → Production                 │
│    │         │            │           │                     │
│    ▼         ▼            ▼           ▼                     │
│  Docker   PR Preview   QA/UAT     Blue-Green                │
│  Compose  (Vercel)    Testing     Deployment                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

| 환경 | 용도 | 배포 방식 |
|------|------|----------|
| Local | 개발자 로컬 | Docker Compose |
| Development | PR Preview | Vercel Preview |
| Staging | QA/UAT | 수동 배포 |
| Production | 실서비스 | Blue-Green |

## Docker 설정

### Backend Dockerfile

```dockerfile
# Dockerfile.backend
FROM node:20-alpine AS base
RUN npm install -g pnpm

# Dependencies
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Builder
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
RUN pnpm build

# Runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

USER nestjs
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

### Docker Compose (Local)

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: app_dev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  backend:
    build:
      context: ./apps/backend
      dockerfile: Dockerfile
    ports:
      - "4000:4000"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/app_dev
      REDIS_URL: redis://redis:6379
      JWT_SECRET: dev-secret-key
    depends_on:
      - postgres
      - redis

volumes:
  postgres_data:
  redis_data:
```

## CI/CD Pipeline

### GitHub Actions

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
  push:
    branches: [main, develop]

env:
  PNPM_VERSION: 8

jobs:
  # 1. 코드 품질 검사
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm format:check

  # 2. 테스트
  test:
    runs-on: ubuntu-latest
    needs: quality
    strategy:
      matrix:
        app: [web, mobile, backend]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm --filter ${{ matrix.app }} test

  # 3. E2E 테스트
  e2e:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm exec playwright install --with-deps
      - run: pnpm --filter web test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: apps/web/playwright-report/

  # 4. 빌드
  build:
    runs-on: ubuntu-latest
    needs: [quality, test]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm build

  # 5. 배포 (main만)
  deploy-staging:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    needs: [build, e2e]
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Staging
        run: echo "Deploy to staging"

  deploy-production:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    needs: deploy-staging
    environment:
      name: production
      url: https://myapp.com
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Production
        run: echo "Deploy to production"
```

## 인프라 (AWS)

```
┌────────────────────────────────────────────────────────────────┐
│                         AWS Architecture                        │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│  │ CloudFront  │───▶│     S3      │    │   Route53   │        │
│  │   (CDN)     │    │  (Static)   │    │   (DNS)     │        │
│  └─────────────┘    └─────────────┘    └─────────────┘        │
│         │                                     │                 │
│         ▼                                     ▼                 │
│  ┌─────────────┐                      ┌─────────────┐          │
│  │     ALB     │◀─────────────────────│   Vercel    │          │
│  │(API Gateway)│                      │  (Next.js)  │          │
│  └──────┬──────┘                      └─────────────┘          │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│  │    ECS      │───▶│    RDS      │    │ ElastiCache │        │
│  │  (NestJS)   │    │ (Postgres)  │    │  (Redis)    │        │
│  └─────────────┘    └─────────────┘    └─────────────┘        │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### 서비스별 배포

| 서비스 | 플랫폼 | 이유 |
|--------|--------|------|
| Next.js Web | Vercel | Edge Functions, ISR 최적화 |
| NestJS Backend | AWS ECS | 컨테이너 기반, 스케일링 |
| Database | AWS RDS | 관리형 PostgreSQL |
| Cache | ElastiCache | 관리형 Redis |
| Static Assets | S3 + CloudFront | CDN |
| Mobile | EAS Build | Expo 네이티브 빌드 |

## 환경 변수 관리

### 구조

```
.env.local          # 로컬 (Git 제외)
.env.development    # 개발 서버
.env.staging        # 스테이징
.env.production     # 프로덕션 (Git 제외)
.env.example        # 예시 (Git 포함)
```

### 변수 네이밍

```bash
# .env.example

# App
NODE_ENV=development
PORT=4000

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/db

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-secret-key
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# OAuth
KAKAO_CLIENT_ID=
KAKAO_CLIENT_SECRET=
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Frontend URLs
FRONTEND_URL=http://localhost:3000
MOBILE_SCHEME=myapp

# AWS (Production)
AWS_REGION=ap-northeast-2
AWS_S3_BUCKET=
```

### Secrets 관리 (Production)

```typescript
// AWS Secrets Manager에서 로드
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

async function loadSecrets() {
  const client = new SecretsManagerClient({ region: 'ap-northeast-2' });
  
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: 'myapp/production' })
  );
  
  const secrets = JSON.parse(response.SecretString);
  
  process.env.JWT_SECRET = secrets.JWT_SECRET;
  process.env.DATABASE_URL = secrets.DATABASE_URL;
  // ...
}
```

## 모니터링

### 메트릭

```
Core Metrics:
- Response Time (P50, P95, P99)
- Error Rate (4xx, 5xx)
- Requests per Second (RPS)
- CPU / Memory Usage
- Database Connections

Business Metrics:
- Daily Active Users (DAU)
- Signups / Logins
- API Endpoint Usage
```

### 로깅 포맷

```typescript
// Structured JSON Logging
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "message": "Request completed",
  "traceId": "abc-123-def",
  "userId": "user-456",
  "method": "POST",
  "path": "/api/users",
  "statusCode": 201,
  "duration": 45,
  "userAgent": "Mozilla/5.0..."
}
```

### 알림 규칙

| 조건 | 심각도 | 알림 |
|------|--------|------|
| Error Rate > 1% | Warning | Slack |
| Error Rate > 5% | Critical | Slack + PagerDuty |
| P95 Latency > 500ms | Warning | Slack |
| P95 Latency > 2s | Critical | Slack + PagerDuty |
| CPU > 80% (5분) | Warning | Slack |
| Memory > 85% | Warning | Slack |
| Database Connections > 80% | Critical | Slack + PagerDuty |

## 백업 & 복구

### Database 백업

```yaml
# 자동 백업 정책
RDS:
  - 자동 백업: 7일 보관
  - 스냅샷: 주 1회, 30일 보관
  - Point-in-Time Recovery: 활성화
```

### 복구 절차

```bash
# 1. 최신 스냅샷에서 복구
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier myapp-recovered \
  --db-snapshot-identifier myapp-snapshot-20240115

# 2. DNS 전환 (Route53)
aws route53 change-resource-record-sets ...

# 3. 애플리케이션 재시작
aws ecs update-service --force-new-deployment ...
```
