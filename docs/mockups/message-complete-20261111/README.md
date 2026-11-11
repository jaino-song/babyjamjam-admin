# 메시지 완성 React 미리보기

`index.html`이 상대 경로의 `styles.css`, `app.js`를 읽고 React `createRoot`로 화면을 마운트합니다. React/ReactDOM 18.3.1은 고정된 esm.sh CDN 모듈을 사용하므로 최초 로드에 인터넷 연결이 필요합니다. 설치·빌드는 없습니다. Main이 이 디렉터리만 정적 HTTP로 제공합니다.

- 기본 템플릿: 서비스 비용 안내 (`PRICE_INFO`). 서비스 내용 안내, 첫 인사, 리마인드도 선택할 수 있습니다.
- 이름과 비용 선택값을 바꾸면 본문을 다시 생성합니다. 선택값 변경은 수동 편집을 초기화하며, 템플릿을 바꿀 때도 이전 편집 내용은 남기지 않습니다.
- 본문을 직접 편집하고 현재 내용을 복사할 수 있습니다. Clipboard API 실패 또는 미지원 시 임시 textarea 선택과 `execCommand("copy")`를 시도하고 결과를 본문 아래 표시합니다.
- 요금·지역·계좌·업체는 가상 예시입니다. 실제 고객·연락처·계좌·지점 데이터를 사용하지 않습니다. 폼 값의 전송·저장과 백엔드 연결은 없습니다.
- 탐색 메뉴는 표시 전용입니다. 실제 애플리케이션 경로·공용 패키지는 변경하지 않았으며, 제품 반영은 사용자 디자인 승인 후 별도 작업입니다.

시각 기준: 첨부 DOM, 모바일 `redesign.css`, 메시지 작성 `page.module.css`, `MessageSectionNav`, `FieldLabelRow`, `MsgField`, 기존 메시지 fallback 함수. 앱 의존성 없이 실행하기 위해 해당 컴포넌트를 import하지 않고 목업 안에서 시각 값을 재현했습니다. 목업 전용 컴포넌트 이름은 `Mockup*`로 구분합니다. 모든 semantic class에는 대응하는 `data-slot`을 두고, `data-component`는 `mobile_messages-complete_mockup`부터 부모 경로를 이어갑니다.

정적 검증:

```sh
node --check docs/mockups/message-complete-20261111/app.js
git diff --check
git status --short
```

Main 확인 대상: React 최초 마운트, 4종 템플릿, 이름·요금·기간·지역·연도 치환, 본문 편집, 템플릿 변경 시 초기화, HTTP 복사 성공/실패 피드백, 좁은 화면, 수신자·발송 컨트롤 부재. 브라우저 확인과 서비스 실행은 이 unit에서 수행하지 않습니다.
