# 메시지 완성 React 승인용 미리보기

기존 `index.html`에서 `dist/preview.js`를 열며, 저장소에 설치된 React 19와 실제 모바일 컴포넌트를 로컬 번들로 실행한다. 제품 라우트·공용 패키지·환경·의존성은 변경하지 않았다. 사용자 디자인 승인과 별도 구현을 기다리는 정적 산출물이다.

## 빌드와 검사

저장소 루트에서 실행한다. Main이 기존 lockfile의 frozen workspace install을 완료한 상태가 전제다. 이 스크립트는 설치·다운로드·서버 시작을 하지 않는다.

```sh
node docs/mockups/message-complete-20261111/build.cjs
node docs/mockups/message-complete-20261111/check.cjs
node docs/mockups/message-complete-20261111/smoke.cjs
for file in docs/mockups/message-complete-20261111/*.cjs; do node --check "$file"; done
git diff --check
```

생성 경로는 이 디렉터리의 `dist/preview.js`, 라이선스 파일, `dist/assets/Pretendard.woff2`다. `dist/`는 git-ignored이며 Main의 기존 Tailscale 전용 정적 서버에서 그대로 제공할 수 있다. 다른 checkout에서는 먼저 빌드해야 한다. 외부 CDN은 필요 없다.

`build.cjs`는 설치된 webpack·SWC·PostCSS/Tailwind·lightningcss를 사용한다. `globals.css`의 기존 Tailwind/import를 컴파일하고 CSS Modules의 원래 selector와 `:global`을 유지한다. 스타일은 번들에서 `<style>`의 `textContent`로 삽입한다. 소스맵을 생성하지 않는다. 필터된 workspace install에서 TypeScript ESLint parser가 빠져 있으므로 `check.cjs`는 기존 mobile tsconfig를 읽어 메모리 안에서 strict/noUnused typecheck를 실행하고, SWC로 변환한 미리보기 소스에 scoped ESLint runtime 규칙을 적용한다. tsconfig 파일은 만들거나 바꾸지 않는다.

## 실제 import와 어댑터

실제 import:

- `ListCard`/내부 header·body, `MobileSectionNav`: 기존 primitives와 Lucide 아이콘/pill을 사용한다. 현재 shared `MESSAGE_SECTION_DEFINITIONS` 순서에서 `전송하기` 다음에 `메시지 완성`을 넣는다.
- `FieldLabelRow`, v3 `Input`, `MsgField`/기존 Textarea, Radix `Select` 패밀리, `Button`: 드롭다운은 실제 portal·선택·포커스·비활성 동작을 쓴다. native select 모조품은 없다.
- `V3MobileHeader`, `V3MainContent`, `MobileBottomNav`: 실제 표시 컴포넌트와 기존 root/app-shell/app-content 구조를 조합한다.
- 기존 메시지 `page.module.css`, `FieldLabelRow.module.css`, `globals.css`, `redesign.css`, Pretendard 파일: 시각 값을 복제하지 않는다. `mobile-app-root`의 전체 viewport 보정도 유지한다. 새 CSS는 정적 폰트 연결뿐이다.

미리보기 전용 경계:

- `navigation.ts`: 표시 경로만 `/messages/new`로 고정한다.
- `link.tsx`: 기존 anchor DOM/스타일을 유지하고 클릭 이동을 막는다. Next Link의 default export 계약만 이 어댑터에서 따른다.
- `identity.ts`: `사용자 님 / 개발QA점`이라는 허구 표시값만 제공한다. 인증·권한 구현이 아니다.
- `notification.tsx`: 실제 헤더에 기존 Button·Bell 아이콘의 subscribed 모양을 표시하는 inert 어댑터다. 실제 NotificationBell의 데이터·구독·popover 트리는 마운트하지 않는다.
- 비동기 `MobileShellProviders` 전체는 마운트하지 않는다. 네트워크·인증 provider·realtime·prefetch·알림 권한 요청을 제외한 위 presentational shell만 조립한다. 다른 섹션과 하단 탐색은 표시 전용이다.

새 production 디자인 시스템 컴포넌트와 `page.tsx` 변경은 없다. 목업 organism 및 field 조립 helper만 이 docs 디렉터리에 있다. 새 semantic 클래스/기존 클래스 조립에는 대응하는 data-slot을 붙이고 기존 import 컴포넌트의 옛 annotation은 수정하지 않았다.

## 오프라인 샘플과 동작

기본값은 첨부 DOM처럼 `서비스 비용 안내`, 빈 이름, `바우처 유형 / 서비스 기간 / 지역`, `2026년`이다. 이름은 plain text Input에 `autoComplete="off"`를 쓴다. 전화 입력·수신자 chip·고객 검색·자동완성·발송 버튼은 없다. 기간은 유형을 고르기 전 비활성이고, 지역은 가상 옵션으로 즉시 선택 가능하다. 연도는 2025/2026/2027로 고정한다.

템플릿 8종은 저장소의 deprecated fallback 함수를 **직접 import**한다: 첫 인사, 서비스 내용 안내, 서비스 비용 안내, 리마인드, 입금 확인 및 예약 완료 안내, 산모 정보 요청, 계약서 작성 요청, 모니터링 설문. 직접 작성도 제공한다. 서버 소유 production catalog를 조회하거나 받은 응답처럼 표시하지 않는다. fallback이 없는 서비스 종료/제공기록지 등은 추가하지 않았다.

본문 문장·줄바꿈·문장부호는 fallback 원문을 보존한다. 다음 미리보기 변환만 적용한다.

- source 함수의 인자에 `{{name}}` 등 토큰을 전달해 미입력 변수를 남긴다. 숫자 전용 weeks 인자는 source가 생성한 `출퇴근 0주`를 `출퇴근 {{weeks}}주`로 치환한다. 첫 인사에는 이름 변수를 만들지 않는다.
- `source-loader.cjs`가 fallback 모듈을 컴파일할 때 전화번호와 예금주 줄만 허구 값으로 치환한다. 원본 앱 파일은 수정하지 않으며 생성 번들에도 원래 연락처/예금주 값이 들어가지 않는다. 본문의 원래 사이트·설문 URL은 plain textarea 문자열로만 남고 자동 요청이나 링크 이동은 없다.
- 유형·기간 label/순서는 기존 `voucher.json`에서 읽는다. 금액은 공개 가격표가 아닌 **허구 계산 샘플**이고 지역·은행·계좌는 `QA-`/`000-` 샘플이다. 실제 고객·연락처·계좌·DB 자료를 읽지 않는다.

이름·유형·기간·지역·연도를 바꾸면 현재 본문을 재생성하며 수동 편집을 해제한다. 유형 변경은 기간을 비우고, 템플릿 변경은 이름/선택/편집/복사 피드백과 연도를 초기화한다. 본문 수동 편집과 복사는 가능하다. HTTP에서 Clipboard API가 없거나 거절되면 실제 본문 textarea의 선택과 `execCommand('copy')`를 사용하고 포커스·선택을 복원한다. 성공·실패 피드백은 기존 label message slot에 표시한다.

## 검증 경계와 보안

빌드, strict TypeScript, scoped runtime lint, Node DOM smoke, CJS 문법 검사와 diff 공백 검사를 실행한다. `smoke.cjs`는 설치된 jsdom에서 로컬 번들만 실행하며 서버·브라우저·네트워크를 사용하지 않는다. 실제 마운트/초기 상태/실제 Radix 키보드 열기·선택·닫기/의존값/템플릿 전환/편집/HTTP 복사 성공·실패를 검사한다. jsdom은 최신 CSS layer를 지원하지 않아 CSS parsing 진단은 시각 판정으로 사용하지 않는다. CSS 문법 컴파일은 lightningcss 빌드가 담당한다.

실제 Chrome의 375px/1280px 스크린샷·DOM·computed style 확인 및 실제 OS clipboard 동작은 **미검증**이다. Node DOM smoke는 시각 승인이나 real-Chrome acceptance를 대신하지 않는다. Main이 기존 Tailscale 전용 8765 서버에서 확인하고 독립 exact-candidate CODE 리뷰를 진행해야 한다.

범위 보안 점검: 데이터는 React text/value로만 렌더링하며 HTML 삽입·입력 코드 실행·fetch·XHR·WebSocket·storage·submit·송신 로직이 없다. HTML CSP는 connect/form 제출을 차단한다. 새 패키지·스키마·auth 변경은 없고 네트워크 dependency audit는 이 unit의 금지 범위라 실행하지 않았다. 되돌리기는 이 docs 변경을 revert하고 해당 docs 디렉터리를 다시 빌드하면 된다.

Vault resolver는 `/home/covenant_labs_server/Development/covenant-labs-vault`를 검증했다. 로컬 CLI 검색은 결과가 없었고 stale index 경고가 있어 과거 결정 부재를 단정하지 않는다. Worker 종료 capture는 하네스 lifecycle에 맡기며 성공 영수증을 확인하지 않았다.
