@~/.agents/playbook/AGENTS.md

## Repo-local: UI 작업 규칙 (BabyJamJam Design System)

frontend/mobile의 UI를 만들거나 고치기 전에 **반드시** 다음 두 파일을 먼저 읽는다:

1. `docs/design-system/AGENT_UI_RULES.md` — 작업/보고 프로토콜과 금지 목록
2. `docs/design-system/component-manifest.json` — 사용 가능한 컴포넌트 전체 목록 (import 경로·대체 패턴 포함)

금지 요약 (ESLint `ui-architecture/*` rule + `lint:ui-architecture` baseline 게이트로 CI 강제):

- `page.tsx` 안에 local 컴포넌트를 정의하지 않는다 — 디자인 시스템 레이어로 추출 후 import.
- `INPUT_CLS` 같은 Tailwind 문자열 상수를 page에 두지 않는다.
- page에서 raw `<button>`/`<input>`/`<select>`/`<textarea>`/`<dialog>`를 쓰지 않는다.
- page의 className에는 layout 클래스만 — 시각 스타일(`bg-*`, `text-*`, `border-*`, `rounded-*`, `shadow-*`)은 컴포넌트 내부로.
- 필요한 컴포넌트가 없으면 page에 만들지 말고, 디자인 시스템에 추가를 먼저 제안한다.

## Repo-local: 인증이 필요한 로컬 QA

- 작업 worktree를 만든 직후 `env-bootstrap`을 실행한다.
- 브라우저 QA 서버는 desktop에서 `pnpm qa:fe`, mobile에서 `pnpm qa:mobile -- --port <port>`로 실행한다.
- 두 명령은 `frontend/.env.local`의 서버 전용 `LOCAL_AUTO_LOGIN_*` 값만 로컬 개발 프로세스에 전달한다. 값이 없거나 로컬 백엔드가 아닌 경우 서버 시작 전에 실패해야 한다.
- 자동 로그인 QA에 `next start`, 터널, reverse proxy, 비루프백 호스트를 사용하지 않는다. 배포와 production-mode 검증은 수동 로그인 경계를 유지한다.

## Repo-local: QA DB와 테스트 계정

**머지 전 QA는 로컬 서버 + dev DB에서 한다.** 후보 worktree 루트에서 백엔드를 `pnpm dev:be`(포트 3001)로 먼저 띄우고, 이어서 위의 `pnpm qa:fe`(웹) 또는 `pnpm qa:mobile -- --port <port>`(모바일)를 띄운다. 두 QA 명령은 Next.js만 띄우고 백엔드는 띄우지 않는다. 백엔드는 `env-bootstrap`이 복사한 `backend/.env`의 dev Supabase(`ebiughoiebblasxwgxbe`)를 쓴다. Docker·Valkey·새 DB를 설치하거나 만들지 않는다. `docker-compose.auth-e2e.yml`은 auth e2e 테스트 전용이고 QA 환경이 아니다. dev DB에 마이그레이션·초기화·seed를 돌리지 않는다.

**dev DB 상태(2026-11-07):** 고객·제공인력은 아래 테스트 계정만 남기고 모두 삭제했다. 테스트가 아닌 고객·제공인력을 dev DB에 새로 넣지 않는다. prod DB(`dsaqfy…`, `backend/.env.prod`)는 실제 고객 데이터가 있는 운영 DB다.

**상시 QA 승인(운영자 결정, 2026-11-07):** "B" — 이 프로젝트의 모든 후보 커밋에 대해 `개발QA점` 범위 안의 테스트 데이터 쓰기를 커밋마다 다시 묻지 않고 허용한다(`~/.agents/playbook/domains/common/agents/qa.md` §2 Standing override). dispatch에는 이 문단을 `operatorOverride`로 인용한다.
- `isolationScope`: 지점 `개발QA점`(slug `dev-qa`). dev·prod 양쪽에 있다.
- `fixturePrefix`: `QA-`. QA가 새로 만드는 레코드 이름은 이 접두어로 시작하고, 만든 레코드는 전부 보고한다.
- `개발QA점` 밖의 레코드는 읽기·수정·메시지 발송을 하지 않는다. 벗어나면 멈추고 `POLICY`로 보고한다.

**테스트 계정 (dev·prod 공통, `개발QA점`):** 연락처는 개발자 본인 것이다. 알림·문자·이메일·전자서명 요청을 제한 없이 보내도 된다. 다른 실제 연락처는 입력하지 않는다. 연락처 값은 커밋하지 않고 git-ignored `frontend/.env.local`에만 둔다(키 목록: `frontend/env.local.tpl`). 값이 없으면 `env-bootstrap`을 먼저 실행한다. QA dispatch의 `--developer-contact-file`은 이 파일을 가리킨다.

| 역할 | 이름 | 전화 키 | 이메일 키 | dev id | prod id |
|---|---|---|---|---|---|
| 테스트 고객 | 테스트 고객 | `QA_DEVELOPER_PHONE` | `QA_DEVELOPER_EMAIL` | client 523 | client 189 |
| 테스트 제공인력 | 테스트 제공인력 (prod는 `QA-관리사`) | `QA_PROVIDER_PHONE` | `QA_PROVIDER_EMAIL` | employee 187 | employee 171 |

- 고객·제공인력 테이블에는 이메일 칸이 없다. 이메일은 이메일 수신이 필요한 흐름(예: 전자서명 수신자)에 입력할 때 쓴다.
- 새 테스트 고객·제공인력이 필요하면 위 연락처로 `개발QA점`에 `QA-` 접두어 이름으로 만든다. 지점별로 같은 전화번호는 한 번만 등록할 수 있다.
- 다른 지점에 같은 전화번호로 등록된 고객·제공인력 레코드는 개발자 본인의 실제 기록이다. QA에 쓰지 않는다.
