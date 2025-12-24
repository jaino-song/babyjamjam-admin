# Architecture Guide

## 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                     Production Architecture                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Next.js    │  │   RN Expo    │  │  Admin Web   │  Clients │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         └────────────┬────┴─────────────────┘                   │
│                      ▼                                          │
│         ┌────────────────────────┐                              │
│         │   API Gateway / ALB    │         Infrastructure       │
│         └───────────┬────────────┘                              │
│                     ▼                                           │
│         ┌────────────────────────┐                              │
│         │   NestJS Backend       │                              │
│         │   (Modular Monolith)   │                              │
│         └───────────┬────────────┘                              │
│    ┌────────────────┼────────────────┬──────────────────┐      │
│    ▼                ▼                ▼                  ▼      │
│ ┌──────┐      ┌──────────┐     ┌──────────┐      ┌──────────┐ │
│ │ RDBMS│      │  Redis   │     │   S3     │      │  Queue   │ │
│ └──────┘      └──────────┘     └──────────┘      └──────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## 레이어 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│ Presentation Layer                                       │
│ (Controllers, React Components, Screens)                 │
├─────────────────────────────────────────────────────────┤
│ Application Layer                                        │
│ (Use Cases, Commands, Queries, Event Handlers)          │
├─────────────────────────────────────────────────────────┤
│ Domain Layer                                             │
│ (Entities, Value Objects, Domain Services, Interfaces)  │
├─────────────────────────────────────────────────────────┤
│ Infrastructure Layer                                     │
│ (Repositories, External APIs, Database, Cache)          │
└─────────────────────────────────────────────────────────┘

의존성 방향: Presentation → Application → Domain ← Infrastructure
Domain Layer는 어떤 것도 의존하지 않음
```

## 모노레포 상세 구조

```
project/
├── apps/
│   ├── web/                     # Next.js App
│   │   ├── src/
│   │   │   ├── app/             # App Router
│   │   │   ├── features/        # Feature modules
│   │   │   ├── shared/          # Shared components
│   │   │   └── core/            # Core setup
│   │   └── e2e/                 # Playwright tests
│   ├── mobile/                  # Expo App
│   │   ├── src/
│   │   │   ├── app/             # Expo Router
│   │   │   ├── features/
│   │   │   ├── shared/
│   │   │   └── core/
│   │   └── e2e/
│   └── backend/                 # NestJS App
│       └── src/
│           ├── modules/         # Feature modules (DDD)
│           ├── shared/          # Shared infrastructure
│           └── core/            # Core setup
├── packages/
│   ├── api-client/              # 공유 API Client
│   ├── types/                   # 공유 TypeScript 타입
│   ├── validators/              # 공유 Zod 스키마
│   ├── constants/               # 공유 상수
│   └── utils/                   # 공유 유틸리티
├── infrastructure/
│   ├── docker/
│   │   ├── Dockerfile.backend
│   │   └── docker-compose.yml
│   └── terraform/
└── docs/
    ├── adr/                     # Architecture Decision Records
    └── api/                     # API Documentation
```

## 핵심 설계 원칙

### 1. Modular Monolith First
- 마이크로서비스 전환 가능한 모듈 경계 설계
- 모듈 간 통신은 인터페이스를 통해서만
- 데이터베이스 스키마는 모듈별 분리 가능하게

### 2. API-First Design
- OpenAPI/Swagger 스펙 먼저 정의
- 프론트엔드/백엔드 병렬 개발 가능
- 타입 자동 생성 활용

### 3. Offline-First (Mobile)
- 로컬 캐시 우선 조회
- 백그라운드 동기화
- Conflict Resolution 전략

### 4. Shared Nothing
- 클라이언트 간 직접 코드 공유 금지
- 패키지를 통한 명시적 공유만 허용
- 플랫폼별 구현은 독립적으로

## 환경 구성

```
Local → Development → Staging → Production
  │         │            │           │
  ▼         ▼            ▼           ▼
Docker   PR Preview   QA/UAT     Blue-Green
Compose  (Vercel)    Testing     Deployment
```

| 환경 | 용도 | 배포 |
|------|------|------|
| Local | 개발자 로컬 | Docker Compose |
| Development | PR Preview | Vercel Preview |
| Staging | QA/UAT 테스트 | 수동 배포 |
| Production | 실서비스 | Blue-Green |
