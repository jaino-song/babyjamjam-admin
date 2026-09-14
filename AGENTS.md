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
