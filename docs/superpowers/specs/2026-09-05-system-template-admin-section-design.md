# 관리자 페이지 메시지 템플릿 섹션 — 기본 템플릿 편집 (Design Spec)

**Date:** 2026-09-05
**Status:** Approved in chat, pending spec review
**Author:** David Jinho Song (+ Claude)
**Builds on:** `2026-06-30-sms-trigger-any-system-template-design.md` (시스템 템플릿이 SMS 자동 발송 본문의 단일 출처가 된 결정)

---

## 1. Goal

오너가 **관리자 페이지(`/system-admin`)** 안의 새 섹션 "메시지 템플릿"에서 기본 템플릿(시스템 템플릿) 9종의 **문구를 편집**하고, 그 템플릿에 허용된 **시스템 변수를 본문에 넣고 뺄 수** 있게 한다. 메시지 페이지의 기본 템플릿 상세에 적힌 "기본 템플릿은 오너 관리자 페이지에서 관리됩니다."가 실제로 성립하게 만든다.

## 2. Background — 현재 상태 (코드로 확인)

- **백엔드는 완성돼 있다.** `system_template`(전역, `templateKey` unique, `content`, `customVariables` JSON) + `system_template_version`(불변 이력). 레지스트리 `backend/domain/constants/system-template-registry.ts`가 9종의 이름/설명/필수 변수/기본 문구를 정의하고, 부트스트랩 서비스가 첫 기동 시 시드한다.
- **엔드포인트** (`backend/interface/controllers/system-template.controller.ts`): `GET /system-templates`, `GET /system-templates/:key`, `PUT /system-templates/:key`(OwnerGuard), `POST …/validate`, `POST …/preview`, `GET …/versions`, `GET …/versions/:n`, `POST …/rollback/:n`(OwnerGuard), `POST …/reset`(OwnerGuard).
- **저장 시 서버 검증** (`system-template-mutation-guard.service.ts`): 레지스트리 필수 변수 누락, 레지스트리·커스텀 어디에도 없는 변수, 닫히지 않은 `{{` 를 400으로 거부. 활성 자동 발송 규칙이 채울 수 없는 필수 커스텀 변수도 거부. 템플릿별 advisory lock으로 자동화 활성화와 직렬화.
- **저장 usecase의 함정**: `UpdateSystemTemplateUseCase.execute(key, content, userId, customVariables = [])` — `customVariables`를 생략하면 **빈 배열로 덮어쓴다**. 프론트 서비스 `systemTemplateService.update`도 인자가 없으면 `{ content }`만 보낸다. 따라서 문구만 편집하는 화면이라도 기존 커스텀 변수를 반드시 그대로 실어 보내야 한다.
- **프론트 기존 자산** (`frontend/src/features/system-templates/`): 훅 `useSystemTemplates`, `useSystemTemplate`, `useUpdateSystemTemplate`, `useTemplateVersions`, `useRollbackTemplate`, `useResetTemplate`(쿼리 키 `systemTemplateKeys`), 컴포넌트 `VersionHistory`(Sheet 트리거 `Button`, 버전 미리보기, 특정 버전 복원, 기본값 초기화, 확인 모달, `onRollback` 콜백 — 테스트 있음), 구형 `SystemTemplateEditor`(raw `Textarea`, shadcn `Card`, raw `<button>` — 디자인 시스템 규칙 위반).
- **숨겨진 라우트**: `frontend/src/app/(protected)/messages/system-templates/[templateKey]/page.tsx`가 구형 편집기를 마운트하지만 앱 어디에서도 링크되지 않는다(`/messages/system-templates`는 지점 템플릿으로 리다이렉트). UI 부채 기준선 `docs/design-system/ui-debt-baseline.json`에 이 파일 항목이 있다.
- **칩 에디터** (`frontend/src/components/app/my-templates/variable-chip-editor.tsx`): Tiptap 기반, props `{ value, onChange, variables: MessageTemplateVariable[], onVariableClick?, placeholder?, id? }`, ref handle `insertVariable(key)`. 자동완성 후보는 `variables` prop에서만 나온다. `{{key}}` 텍스트로 무손실 직렬화. 미리보기 `template-preview.tsx`는 `{ content, variables }`를 받아 `[라벨]` 치환 + 바이트 수를 보여준다.
- **관리자 콘솔** (`frontend/src/components/app/system-admin/OwnerAdminConsole.tsx`, 1588줄): `OWNER_ADMIN_SECTIONS`(branches/accounts/notifications) 설정 배열 + `AdminSectionId` 유니온 + `SECTION_ICON_CLASSNAMES` + `SectionNav` + 섹션 공용 `SplitLayout`. 섹션 상태는 로컬 state이며 쿼리 파라미터를 읽지 않는다. 라우트 레이아웃이 오너가 아니면 `/dashboard`로 보낸다.
- **메시지 페이지** (`frontend/src/app/(protected)/messages/page.tsx`): `isOwner = user?.role === ROLES.owner`가 이미 있다. 기본 템플릿 목록 아이콘 매핑(`BUILTIN_TEMPLATES`, 191행~)이 있다.
- **소비처 빈틈(범위 밖으로 확정)**: 전송하기 폼 8개는 레지스트리 변수 입력란만 그리고 `customVariables`를 무시한다. 자동 전송 규칙 화면(`TriggerRulesManager`)은 커스텀 변수를 인식한다.

## 3. 결정 사항

| 결정 | 선택 | 근거 |
|---|---|---|
| 변수 편집 범위 | **문구 + 시스템 변수 삽입/삭제**만 | 백엔드 변경 없음. 커스텀 변수는 전송 폼 8개 수정이 함께 필요해 다음 사이클 |
| 편집기 | **칩 에디터 재사용** | 지점 템플릿과 같은 경험, 무손실 직렬화, 후보 목록을 prop으로 제한 가능 |
| 위치 | 관리자 페이지 4번째 섹션, 전용 organism | `docs/ui-rules.md` §1.3 "섹션 하나 = organism 하나" |
| 버전/초기화 | 기존 `VersionHistory` 재사용 | 롤백·초기화·확인 모달·테스트가 이미 있음 |
| 미리보기 | 기존 `TemplatePreview` 재사용 | 수동 발송과 같은 프론트 렌더러, 네트워크 불필요 |
| 구형 편집 라우트 | 새 섹션 딥링크로 리다이렉트, 구형 편집 컴포넌트 삭제 | 규칙 위반 화면을 남기지 않음 |

## 4. 설계

### 4.1 관리자 콘솔 연결 — `OwnerAdminConsole.tsx`

- `AdminSectionId`에 `"templates"` 추가. `OWNER_ADMIN_SECTIONS`에 `{ id: "templates", label: "메시지 템플릿", icon: MessageSquareText, listTitle: "메시지 템플릿", stats: [], emptyMessage/detailEmptyMessage: 미사용 문자열, records: [] }`를 **계정 관리와 알림 테스트 사이**에 추가. `SECTION_ICON_CLASSNAMES`에 항목 추가.
- 렌더링: `activeSection.id === "templates"`이면 공용 `SplitLayout` 대신 `<SystemTemplatesManager dataComponent="desktop_system-admin_sections_templates-section_manager" initialTemplateKey={…} />`를 마운트한다. 다른 섹션의 코드 경로는 건드리지 않는다.
- 딥링크: 마운트 시 `useSearchParams()`로 `section`, `template`을 한 번 읽는다. `section=templates`면 초기 활성 섹션을 templates로, `template=<SystemTemplateKey>`면 organism의 `initialTemplateKey`로 넘긴다. 유효하지 않은 값은 무시한다. URL을 되쓰지는 않는다(기존 콘솔이 URL 상태를 쓰지 않으므로 최소 변경).

### 4.2 organism — `frontend/src/components/app/system-admin/SystemTemplatesManager.tsx`

`docs/ui-rules.md` §8.2 스캐폴드(단일 시스템 정의 항목형 `ContractAutomationsManager`에 가까움)를 복제해 만든다. props: `{ dataComponent: string; initialTemplateKey?: SystemTemplateKey }`.

**목록(`ListPanel`)**
- `title="메시지 템플릿"`, `subtitle="고객에게 보내는 기본 메시지의 문구와 변수를 관리합니다"`. 탭·검색·`headerActions` 없음(시스템 정의 9종, 생성/삭제 없음).
- `useSystemTemplates()` 결과를 `SYSTEM_TEMPLATE_KEYS` 순서로 정렬해 `AnimatedSlotList` 행으로 그린다. 행: `icon`(템플릿 키 → lucide 아이콘 매핑; 메시지 페이지 `BUILTIN_TEMPLATES`와 같은 아이콘을 쓰되 organism 안의 `Record<SystemTemplateKey, LucideIcon>`으로 둔다), `title=name`, `subtitle="필수 변수 N개 · 최근 수정 MM.DD"`(`requiredVariables.length`, `updatedAt`). `status` 슬롯 없음.
- 로딩: `isLoading` + `loadingCount={9}`; 오류: `ListEmptyState message="템플릿을 불러오지 못했습니다."`.

**상세(`DetailPanel`)**
- 선택 없음: `DetailEmptyState icon={MessageSquareText} message="왼쪽 목록에서 템플릿을 선택하세요"`.
- 선택 시 `title=name`, `subtitle=description`, `tabs=DetailTabs([{key:"edit",label:"템플릿 편집"},{key:"preview",label:"미리보기"}])`.
- footer(`Button`만, 보조 → 주 순서): `[버전 기록]`(=`<VersionHistory templateKey onRollback={resetDraftToServer} />`, 트리거가 outline `Button`) `[되돌리기]`(outline, `!isDirty`면 disabled) `[저장]`(positive, `!isDirty || !clientValid || isPending`면 disabled, pending 시 "저장 중...").

**편집 탭**
- 변수 삽입 줄: `template.requiredVariables`와 `template.customVariables`를 작은 outline `Button` 라벨 버튼으로 나열. 클릭 → `chipEditorRef.current.insertVariable(key)`. 필수 변수(`required: true`)는 라벨 앞에 `*` 표시. 커스텀 변수는 "커스텀" 표기로 구분(편집 불가, 삽입만 가능).
- 본문: `VariableChipEditor value={draft} onChange={setDraft} variables={allowedVariables}`. `allowedVariables`는 레지스트리 변수 + 기존 커스텀 변수를 `MessageTemplateVariable`(`{ key, label, type: "text", required }`)로 매핑한 목록 **만**. 지점 템플릿 프리셋(`PRESET_VARIABLES`)과 `VariableInserter`는 쓰지 않는다.
- 본문 아래: 바이트 수 `getTextByteLength(draft)` / `SMS_BYTE_LIMIT`(90) 초과 시 "LMS로 발송됩니다" 안내(`text-v3-text-muted`), 그리고 클라이언트 검증 힌트.
- 클라이언트 검증(저장 버튼 게이트, 서버 검증의 선반영): `extractVariables(draft)` 기준으로 (a) `required: true`인 레지스트리 변수 중 본문에 없는 것 → "필수 변수 누락: {{key}}", (b) 허용 목록(레지스트리 ∪ 커스텀)에 없는 변수 → "정의되지 않은 변수: {{key}}", (c) `/\{\{(?![^{]*\}\})/` 매치 → "닫히지 않은 {{ 가 있습니다". 문구는 서버 메시지와 동일하게 맞춘다. 서버 400은 응답 `errors[].message`를 합쳐 destructive 토스트로 보여준다.

**저장/되돌리기/동기화**
- `useUpdateSystemTemplate().mutate({ key, content: draft, customVariables: template.customVariables ?? [] })` — 기존 커스텀 변수를 **항상** 함께 보낸다(§2 함정). 성공: `isDirty=false`, 토스트 "템플릿을 저장했어요". 실패: 토스트 "템플릿을 저장하지 못했어요"(서버 메시지 있으면 그것).
- 되돌리기: `draft = template.content`, `isDirty=false`.
- 선택 변경 시 draft를 새 템플릿 값으로 리셋(§2.6 규칙). 쿼리 데이터가 갱신되고 `!isDirty`면 draft를 서버 값으로 동기화(롤백/초기화 후 반영 경로).
- 편집 중 다른 템플릿을 고르면 변경 사항을 잃는다. v1에서는 이탈 경고 없이 §2.6 규칙대로 리셋한다(경고 다이얼로그는 범위 밖).

**미리보기 탭**
- `<TemplatePreview content={draft} variables={allowedVariables} />` — 변수를 `[라벨]`로 치환한 결과와 바이트 수. 편집 탭의 초안을 그대로 반영한다.

**DOM 주석**: 모든 v3 컴포넌트에 `data-component={component("…")}` (`DATA-COMPONENT-CONVENTION.md`). 빈 상태/선택 상태 `DetailPanel`은 `detail-panel-empty` / `detail-panel`.

### 4.3 메시지 페이지 링크 — `messages/page.tsx`

- 기본 템플릿 상세(`isBranchTemplate === false`)에서 `isOwner`일 때만 `HeaderActionButton icon={Pencil} label="관리자 페이지에서 수정" href="/system-admin?section=templates&template=<selectedBuiltinSystemKey>"`를 상세 헤더의 `trailing` 자리(이미 다른 요소가 있으면 그 옆)에 둔다. 오너가 아니면 렌더하지 않는다(부제 문구는 그대로).
- 페이지 diff는 링크 한 요소로 제한한다.

### 4.4 구형 라우트 정리

- `messages/system-templates/[templateKey]/page.tsx` → 서버 컴포넌트로 바꿔 `redirect("/system-admin?section=templates&template=<templateKey>")`만 남긴다(키가 `SYSTEM_TEMPLATE_KEYS`에 없으면 `/system-admin?section=templates`).
- `features/system-templates/components/system-template-editor.tsx` 삭제, `components/index.ts`의 export 제거. 다른 import 없음(확인: 이 페이지만 사용).
- `docs/design-system/ui-debt-baseline.json`에서 위 페이지 항목 제거(파일이 위반 없는 리다이렉트만 남으므로).
- `components/app/messages/templates/messageTemplate/infoMsg.ts` 상단 주석의 "/messages/system-templates" 안내를 새 위치로 고친다.

## 5. 데이터 흐름

```
useSystemTemplates ──▶ 목록 행 (9)
    선택 ──▶ template (목록 캐시에서) ──▶ draft(content) / allowedVariables
        편집 ──▶ 클라이언트 검증 ──▶ [저장] ──▶ PUT /system-templates/:key {content, customVariables(기존)} ──▶ invalidate(all, detail)
        [버전 기록] ──▶ VersionHistory(rollback|reset) ──▶ invalidate(all) ──▶ onRollback ──▶ draft = 서버 값
메시지 페이지 상세(오너) ──▶ /system-admin?section=templates&template=KEY ──▶ 콘솔 초기 섹션/선택
```

새 API, 새 Next 프록시 라우트, 새 공유 타입은 없다(desktop `src/app/api/system-templates/**` 프록시가 이미 존재).

## 6. 오류 처리

| 상황 | 처리 |
|---|---|
| 목록 조회 실패 | `ListEmptyState` 문구 + 상세 빈 상태 |
| 저장 400(검증) | 서버 `errors[].message`를 토스트로. 폼은 비활성화하지 않음 |
| 저장 403/401 | 토스트만("권한이 없어요" / 세션 만료는 기존 인터셉터 경로) |
| 롤백/초기화 실패 | `VersionHistory` 기존 처리 유지 |
| 딥링크 잘못된 키 | 무시하고 선택 없음 상태 |

## 7. 테스트

- `frontend/src/components/app/system-admin/__tests__/SystemTemplatesManager.test.tsx` (`TriggerRulesManager.test.tsx`의 react-query 모킹 방식): (1) 모킹된 9종이 순서대로 행으로 렌더된다, (2) 행 선택 시 편집 탭에 본문이 로드되고 변수 버튼이 레지스트리+커스텀만 나온다, (3) 본문 변경 → 저장 활성 → 저장 시 `update`가 `{ key, content, customVariables: 기존값 }`으로 호출된다, (4) 필수 변수를 지우면 누락 힌트가 뜨고 저장이 비활성이다, (5) `initialTemplateKey`가 주어지면 그 템플릿이 선택된 채 열린다.
- `OwnerAdminConsole.test.tsx` 확장: 섹션 내비에 "메시지 템플릿"이 있고 클릭 시 organism이 마운트된다; `?section=templates&template=GREETING`이면 초기 섹션이 templates이고 organism에 키가 전달된다.
- `messages/page.test.tsx` 확장: 오너면 "관리자 페이지에서 수정" 링크가 올바른 href로 보이고, 오너가 아니면 없다.
- 리다이렉트 페이지: `redirect` 호출 인자 단위 테스트 1건(선택).
- 게이트: `npm run type-check`, `npx eslint <변경 파일>`, `npx jest src/components/app/system-admin src/app/(protected)/messages`, `pnpm lint:ui-architecture`(기준선 감소만 허용).

## 8. 변경 파일

| 파일 | 변경 |
|---|---|
| `frontend/src/components/app/system-admin/SystemTemplatesManager.tsx` | 신규 organism |
| `frontend/src/components/app/system-admin/__tests__/SystemTemplatesManager.test.tsx` | 신규 |
| `frontend/src/components/app/system-admin/OwnerAdminConsole.tsx` | 섹션 추가, organism 마운트, 쿼리 파라미터 초기값 |
| `frontend/src/components/app/system-admin/__tests__/OwnerAdminConsole.test.tsx` | 케이스 추가 |
| `frontend/src/app/(protected)/messages/page.tsx`, `page.test.tsx` | 오너 링크 |
| `frontend/src/app/(protected)/messages/system-templates/[templateKey]/page.tsx` | 리다이렉트로 교체 |
| `frontend/src/features/system-templates/components/system-template-editor.tsx`, `index.ts` | 삭제 / export 제거 |
| `frontend/src/components/app/messages/templates/messageTemplate/infoMsg.ts` | 주석 |
| `docs/design-system/ui-debt-baseline.json` | 항목 제거 |

## 9. 범위 밖

- 커스텀 변수 추가/삭제/필수 여부 편집과 전송 폼 8개의 커스텀 변수 입력란(다음 사이클; 백엔드는 이미 지원).
- 시스템 변수 표시 이름 변경, 커스텀 변수 기본값(fallback), 지점별 기본 템플릿 재정의.
- 모바일(m.admin) 반영 — 모바일은 자체 `/messages/system-templates/[templateKey]` 페이지를 그대로 유지.
- 백엔드 변경 일체. 편집 중 이탈 경고.

## 10. 계획에서 확정할 검증 포인트 (블로커 아님)

1. `OwnerAdminConsole`이 `useSearchParams`를 쓰려면 Suspense 경계가 필요한지(Next App Router 정적 렌더 경고) — 페이지가 이미 클라이언트 컴포넌트를 마운트하므로 필요 시 `page.tsx`에서 `Suspense`로 감싼다.
2. `VariableChipEditor`가 `variables`에 없는 `{{key}}`를 어떻게 렌더하는지(칩 vs 텍스트) — 검증 힌트가 어차피 잡지만 시각 확인.
3. `DetailPanel` footer에 `VersionHistory`의 Sheet 트리거 `Button`을 두는 것이 §8.3 "footer는 Button만" 규칙에 부합함을 리뷰에서 확인.
