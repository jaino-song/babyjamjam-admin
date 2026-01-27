# Railway 배포 삽질기: NestJS 서버가 안 뜰 때

> Railway에 NestJS 백엔드를 배포하면서 겪은 문제들과 해결 과정을 공유합니다. 여러 번의 시도와 롤백 끝에 찾은 해결책입니다.

## 목차
1. [문제 상황](#문제-상황)
2. [디버깅 과정](#디버깅-과정)
3. [최종 해결책](#최종-해결책)
4. [Railway 배포 체크리스트](#railway-배포-체크리스트)

---

## 문제 상황

### 증상

Railway에 NestJS 백엔드를 배포했는데, 다양한 에러가 발생했습니다:

```
Error: Cannot find module '@nestjs/cli'
```

```
Error: address already in use :::3001
```

```
Connection refused
```

**로컬에서는 완벽하게 작동하는데** Railway에서만 실패.

### 환경

- **Framework:** NestJS 10.x
- **Platform:** Railway
- **Node.js:** 20.x
- **Package Manager:** pnpm

---

## 디버깅 과정

### 시도 1: `node dist/main` 직접 실행

```json
// package.json
{
    "scripts": {
        "start:prod": "node dist/main"
    }
}
```

**결과:** ❌ 실패
- `dist` 폴더가 없음 (빌드가 안 됨)
- Railway에서 `npm run build` 후 `npm run start:prod` 실행하는데, `dist`가 생성 안 됨

**원인:** `@nestjs/cli`가 `devDependencies`에만 있어서 production 빌드 시 설치 안 됨

---

### 시도 2: `nest build && node dist/main`

```json
{
    "scripts": {
        "build": "nest build",
        "start:prod": "nest build && node dist/main"
    }
}
```

**결과:** ❌ 실패
```
Error: Cannot find module '@nestjs/cli'
```

**원인:** 동일. `nest` 명령어 자체가 없음.

---

### 시도 3: dependencies로 이동

```json
{
    "dependencies": {
        "@nestjs/cli": "^10.0.0",
        "ts-node": "^10.9.0",
        "typescript": "^5.0.0"
    }
}
```

**결과:** ⚠️ 부분 성공
- 빌드는 됨
- 하지만 서버 접속 불가

**원인:** 네트워크 바인딩 문제

---

### 시도 4: 0.0.0.0 바인딩

```typescript
// main.ts (수정 전)
await app.listen(3001);

// main.ts (수정 후)
await app.listen(3001, '0.0.0.0');
```

**결과:** ❌ 실패
```
Error: address already in use :::3001
```

**원인:** Railway는 `PORT` 환경변수를 자동 설정하는데, 고정 포트 사용 시 충돌

---

### 시도 5: 동적 포트 사용

```typescript
// main.ts
await app.listen(process.env.PORT || 3001, '0.0.0.0');
```

**결과:** ⚠️ 부분 성공
- 로그에 서버 시작 확인
- 하지만 여전히 외부 접속 불가

**원인:** Railway의 내부 라우팅과 호환 문제

---

### 시도 6: nest start 사용 + 고정 포트

```json
{
    "scripts": {
        "start:prod": "nest start"
    }
}
```

```typescript
// main.ts
await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
```

**결과:** ✅ 성공!

---

## 최종 해결책

### 1. Dependencies 설정

```json
// package.json
{
    "dependencies": {
        // NestJS core
        "@nestjs/common": "^10.0.0",
        "@nestjs/core": "^10.0.0",
        "@nestjs/platform-express": "^10.0.0",
        
        // 🔑 Production에서도 필요한 dev 도구들
        "@nestjs/cli": "^10.0.0",
        "ts-node": "^10.9.0",
        "typescript": "^5.0.0",
        
        // ... 기타 dependencies
    },
    "devDependencies": {
        // 테스트, 린트 등 개발 전용 도구만
        "@types/node": "^20.0.0",
        "jest": "^29.0.0",
        "eslint": "^8.0.0"
    }
}
```

### 2. 시작 스크립트

```json
{
    "scripts": {
        "build": "nest build",
        "start": "nest start",
        "start:dev": "nest start --watch",
        "start:prod": "nest start"
    }
}
```

> **참고:** `node dist/main` 대신 `nest start`를 사용하면 `@nestjs/cli`가 알아서 빌드하고 실행합니다.

### 3. 네트워크 바인딩

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    
    // CORS 설정
    app.enableCors({
        origin: [
            process.env.FRONTEND_URL,
            'http://localhost:3000',
        ],
        credentials: true,
    });
    
    // 🔑 Railway 호환 바인딩
    const port = process.env.PORT ?? 3001;
    await app.listen(port, '0.0.0.0');
    
    console.log(`Server running on port ${port}`);
}

bootstrap();
```

### 4. Railway 설정

Railway 대시보드 또는 `railway.json`:

```json
{
    "$schema": "https://railway.app/railway.schema.json",
    "build": {
        "builder": "NIXPACKS"
    },
    "deploy": {
        "startCommand": "npm run start:prod",
        "healthcheckPath": "/health",
        "healthcheckTimeout": 300
    }
}
```

### 5. Health Check 엔드포인트

Railway가 서버 상태를 확인할 수 있도록:

```typescript
// health.controller.ts
@Controller('health')
export class HealthController {
    @Get()
    check() {
        return { status: 'ok', timestamp: new Date().toISOString() };
    }
}
```

---

## 왜 이런 문제가 발생했나?

### devDependencies vs dependencies

| 구분 | 설치 시점 | 예시 |
|------|----------|------|
| dependencies | 항상 설치 | express, prisma |
| devDependencies | `NODE_ENV !== 'production'`일 때만 | jest, eslint |

Railway는 기본적으로 `NODE_ENV=production`으로 설정하므로:
```bash
npm install --omit=dev  # devDependencies 제외
```

`@nestjs/cli`가 `devDependencies`에 있으면 → 설치 안 됨 → `nest build` 실패

### localhost vs 0.0.0.0

| 바인딩 | 접근 범위 |
|--------|----------|
| `localhost` / `127.0.0.1` | 같은 머신에서만 |
| `0.0.0.0` | 모든 네트워크 인터페이스 |

Railway 컨테이너 외부에서 접근하려면 `0.0.0.0` 필수.

### PORT 환경변수

Railway는 자체적으로 `PORT` 환경변수를 설정합니다:
- 내부적으로 사용하는 포트 할당
- 고정 포트 사용 시 충돌 가능

**권장:** `process.env.PORT`를 우선 사용하되, 로컬 개발용 기본값 설정.

---

## Railway 배포 체크리스트

### package.json

- [ ] `@nestjs/cli`가 `dependencies`에 있는가?
- [ ] `ts-node`가 `dependencies`에 있는가?
- [ ] `typescript`가 `dependencies`에 있는가?
- [ ] `start:prod` 스크립트가 정의되어 있는가?

### main.ts

- [ ] `0.0.0.0`에 바인딩하는가?
- [ ] `process.env.PORT`를 사용하는가?
- [ ] CORS가 올바르게 설정되어 있는가?

### 환경변수

- [ ] `DATABASE_URL`이 설정되어 있는가?
- [ ] `JWT_SECRET`이 설정되어 있는가?
- [ ] `FRONTEND_URL`이 설정되어 있는가?

### Health Check

- [ ] `/health` 엔드포인트가 있는가?
- [ ] 단순한 200 응답을 반환하는가?

---

## 디버깅 팁

### Railway 로그 확인

```bash
# Railway CLI 설치
npm install -g @railway/cli

# 로그인
railway login

# 프로젝트 연결
railway link

# 실시간 로그
railway logs
```

### 로컬에서 Production 시뮬레이션

```bash
# devDependencies 제외하고 설치
npm ci --omit=dev

# production 모드로 실행
NODE_ENV=production npm run start:prod
```

### Heartbeat 로깅 추가 (디버깅용)

```typescript
// main.ts
async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    
    const port = process.env.PORT ?? 3001;
    
    await app.listen(port, '0.0.0.0');
    
    console.log(`🚀 Server started on port ${port}`);
    
    // 디버깅용 heartbeat
    setInterval(() => {
        console.log(`💓 Heartbeat: ${new Date().toISOString()}`);
    }, 30000);
}
```

---

## 다른 플랫폼과의 비교

| 플랫폼 | PORT 설정 | 바인딩 | 특이사항 |
|--------|----------|--------|----------|
| **Railway** | 자동 (`PORT` 환경변수) | `0.0.0.0` 필수 | `nest start` 권장 |
| **Render** | 자동 (`PORT`) | `0.0.0.0` 필수 | Health check 필수 |
| **Fly.io** | `fly.toml`에서 설정 | `0.0.0.0` 필수 | Dockerfile 사용 |
| **Vercel** | Serverless | N/A | API Routes만 |
| **AWS ECS** | Task Definition | `0.0.0.0` | ALB 연동 |

---

## 커밋 히스토리 (삽질의 기록)

```
91cacb46 - fix: explicitly bind to 0.0.0.0
aa56b306 - fix: use node dist/main for production
413ac00e - fix: simplify port binding
e672a1b2 - debug: add error handlers and heartbeat logging
c91e67f2 - fix: revert to nest start and port 3001 ← 최종 해결
07cb71d9 - fix: move nest start dependencies to production deps
```

> 6번의 커밋 끝에 해결. 삽질도 기록으로 남기면 다음에 도움이 됩니다.

---

## 정리

### 핵심 포인트

1. **`@nestjs/cli`는 dependencies로** - Production 빌드에도 필요
2. **`0.0.0.0` 바인딩** - 컨테이너 외부 접근 허용
3. **`process.env.PORT` 사용** - 플랫폼 자동 할당 포트 수용
4. **`nest start` 사용** - CLI가 빌드와 실행을 처리

### 일반화된 교훈

> **"로컬에서 되는데 배포하면 안 돼요"**는 대부분 환경 차이 문제.

- `NODE_ENV`에 따른 패키지 설치 차이
- 네트워크 바인딩 설정
- 환경변수 설정
- 파일 시스템 경로

이 네 가지를 순서대로 확인하면 대부분 해결됩니다.

---

## 참고 자료

- [Railway Documentation](https://docs.railway.app/)
- [NestJS Deployment](https://docs.nestjs.com/faq/serverless)
- [Node.js Production Best Practices](https://expressjs.com/en/advanced/best-practice-performance.html)
