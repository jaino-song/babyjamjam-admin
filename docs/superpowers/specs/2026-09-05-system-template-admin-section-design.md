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
- **지점 템플릿 편집기가 이미 있다** (`frontend/src/components/app/my-templates/template-editor.tsx`, 260줄): 이름 입력 → 빠른 삽입 줄(`VariableInserter`, 프리셋 10종 + `prompt()` 커스텀 추가) → `Popover`로 감싼 칩 에디터(칩 클릭 시 `PopoverAnchor` 기준으로 `VariableConfigurator variant="popover"`가 열림) → 바이트 푸터(`getTextByteLength`, `SMS_BYTE_LIMIT`, `MAX_BODY_LENGTH` 초과 문구) → 감지된 변수별 `VariableConfigurator` 카드 목록 → 변수가 없을 때 Tip `Alert` → `TemplatePreview` → 취소/저장 버튼. 저장은 `useCreateMessageTemplate`/`useUpdateMessageTemplate`을 직접 호출하고 성공 시 `router.push("/messages/templates")`. 소비처는 `/messages/templates/new`와 `/messages/templates/[id]/edit` 두 페이지뿐이며 둘 다 `<TemplateEditor />`를 그대로 마운트한다. **테스트는 없다.**
- **`VariableConfigurator`는 지점 템플릿 전용 폼이다**: 라벨·타입(`text|phone|select|date|number|textarea`)·필수 여부·fallback·옵션·min/max를 모두 편집한다. 시스템 템플릿의 변수 타입은 `'string'|'number'|'currency'`(다른 유니온)이고 `PUT /system-templates/:key`는 이 값들을 저장하지 않는다.
- **관리자 콘솔** (`frontend/src/components/app/system-admin/OwnerAdminConsole.tsx`, 1588줄): `OWNER_ADMIN_SECTIONS`(branches/accounts/notifications) 설정 배열 + `AdminSectionId` 유니온 + `SECTION_ICON_CLASSNAMES` + `SectionNav` + 섹션 공용 `SplitLayout`. 섹션 상태는 로컬 state이며 쿼리 파라미터를 읽지 않는다. 라우트 레이아웃이 오너가 아니면 `/dashboard`로 보낸다.
- **메시지 페이지** (`frontend/src/app/(protected)/messages/page.tsx`): `isOwner = user?.role === ROLES.owner`가 이미 있다. 기본 템플릿 목록 아이콘 매핑(`BUILTIN_TEMPLATES`, 191행~)이 있다.
- **소비처 빈틈(범위 밖으로 확정)**: 전송하기 폼 8개는 레지스트리 변수 입력란만 그리고 `customVariables`를 무시한다. 자동 전송 규칙 화면(`TriggerRulesManager`)은 커스텀 변수를 인식한다.

## 3. 결정 사항

| 결정 | 선택 | 근거 |
|---|---|---|
| 변수 편집 범위 | **문구 + 시스템 변수 삽입/삭제**만 | 백엔드 변경 없음. 커스텀 변수는 전송 폼 8개 수정이 함께 필요해 다음 사이클 |
| 편집기 | **지점 템플릿 편집기를 공용 코어로 분리해 그대로 사용** | 부품을 다시 조립하지 않고 이미 검증된 화면(빠른 삽입 줄 + 칩 에디터 + 칩 클릭 팝오버 + 바이트 푸터)을 한 컴포넌트로 공유. 두 화면이 같은 편집 경험 |
| 변수 설정 팝오버 | 지점 템플릿은 편집 가능, **기본 템플릿은 읽기 전용** | 기본 템플릿의 변수 정의(라벨·타입·필수)는 백엔드 레지스트리 소유이고 `PUT`이 저장하지 않는다. 편집 가능한 폼을 보여주면 저장되지 않는 값을 약속하게 됨 |
| 지점 템플릿 화면 | 리팩터링 범위에 포함, **동작 변화 없음** | 코어를 빼내면 `template-editor.tsx`가 바뀐다. 회귀 테스트로 기존 동작을 고정한 뒤에만 바꾼다 |
| 위치 | 관리자 페이지 4번째 섹션, 전용 organism | `docs/ui-rules.md` §1.3 "섹션 하나 = organism 하나" |
| 버전/초기화 | 기존 `VersionHistory` 재사용 | 롤백·초기화·확인 모달·테스트가 이미 있음 |
| 미리보기 | 기존 `TemplatePreview` 재사용 | 수동 발송과 같은 프론트 렌더러, 네트워크 불필요 |
| 구형 편집 라우트 | 새 섹션 딥링크로 리다이렉트, 구형 편집 컴포넌트 삭제 | 규칙 위반 화면을 남기지 않음 |

## 4. 설계

### 4.1 관리자 콘솔 연결 — `OwnerAdminConsole.tsx`

- `AdminSectionId`에 `"templates"` 추가. `OWNER_ADMIN_SECTIONS`에 `{ id: "templates", label: "메시지 템플릿", icon: MessageSquareText, listTitle: "메시지 템플릿", stats: [], emptyMessage/detailEmptyMessage: 미사용 문자열, records: [] }`를 **계정 관리와 알림 테스트 사이**에 추가. `SECTION_ICON_CLASSNAMES`에 항목 추가.
- 렌더링: `activeSection.id === "templates"`이면 공용 `SplitLayout` 대신 `<SystemTemplatesManager dataComponent="desktop_system-admin_sections_templates-section_manager" initialTemplateKey={…} />`를 마운트한다. 다른 섹션의 코드 경로는 건드리지 않는다.
- 딥링크: 마운트 시 `useSearchParams()`로 `section`, `template`을 한 번 읽는다. `section=templates`면 초기 활성 섹션을 templates로, `template=<SystemTemplateKey>`면 organism의 `initialTemplateKey`로 넘긴다. 유효하지 않은 값은 무시한다. URL을 되쓰지는 않는다(기존 콘솔이 URL 상태를 쓰지 않으므로 최소 변경).

### 4.2 공용 편집 코어 — `frontend/src/components/app/my-templates/template-content-editor.tsx` (신규)

기본 템플릿 화면을 위해 부품을 새로 조립하지 않는다. 지점 템플릿 편집기에서 **이름 입력 · 저장 훅 · 페이지 이동**을 떼어낸 순수 표현 컴포넌트를 만들고, 지점 템플릿과 기본 템플릿이 같은 코어를 쓴다.

**코어에 들어가는 것** (`TemplateEditor`의 현재 render 본문에서 그대로 옮긴다)
1. 빠른 삽입 줄 — `quickInsert` 슬롯과 그 위 소제목(`template-editor.quick-insert`).
2. 본문 라벨(`label` 슬롯; 없으면 라벨 줄 자체를 그리지 않는다).
3. `Popover` + `PopoverAnchor` + `VariableChipEditor` + `PopoverContent` 배선 — 칩 클릭 → `activeVariableKey` → 팝오버. `onOpenAutoFocus`/`onFocusOutside` 억제, `side="bottom" align="start" sideOffset={8} avoidCollisions className="w-80"`까지 현재 값을 그대로 유지한다.
4. 바이트 푸터 — `getTextByteLength`, `SMS_BYTE_LIMIT`, `MAX_BODY_LENGTH` 초과 문구.
5. 푸터 아래 `hint` 슬롯(기본 템플릿의 검증 힌트가 들어갈 자리; 지점 템플릿은 넘기지 않는다).

**코어에 들어가지 않는 것** — 이름 입력, `ContentPaper` 래퍼, 변수 설정 카드 목록, Tip `Alert`, `TemplatePreview`, 액션 버튼. 두 화면에서 위치와 유무가 다르므로 각 소비처가 코어 바깥에서 조립한다(기본 템플릿은 미리보기가 별도 탭, 액션이 `DetailPanel` footer).

**인터페이스**

```ts
export interface TemplateContentEditorHandle { insertVariable: (key: string) => void }

export interface TemplateContentEditorProps {
    id?: string;
    dataComponent: string;               // 자식은 `${dataComponent}_content-anchor`, `_variable-popover`
    label?: ReactNode;
    quickInsert?: ReactNode;
    content: string;
    onContentChange: (content: string) => void;
    variables: TemplateVariable[];       // 칩 후보 + 팝오버 조회 대상
    onVariableChange?: (variable: TemplateVariable) => void;  // 생략 → 팝오버 읽기 전용
    placeholder?: string;
    hint?: ReactNode;
}
```

`forwardRef`로 `insertVariable`을 노출한다(내부적으로 `VariableChipEditor` handle에 위임). 소비처는 이 ref로 자기 빠른 삽입 줄을 배선한다.

**읽기 전용 모드**: `onVariableChange`가 없으면 팝오버 내용이 `VariableConfigurator` 대신 코어 안의 작은 읽기 전용 블록(`{{key}}`, 라벨, 필수/선택)이 된다. `VariableConfigurator`에 `disabled`를 다는 방식은 쓰지 않는다 — 그 폼의 타입 유니온(`text|phone|…`)과 fallback·옵션 필드는 시스템 템플릿에 존재하지 않아 비활성 상태로도 틀린 정보를 보여주게 된다(§2).

**`VariableInserter` 확장**(같은 파일 아님, `variable-inserter.tsx`): props에 `variables?: { key: string; label: string }[]`(기본 `PRESET_VARIABLES`), `allowCustom?: boolean`(기본 `true`), `dataComponent?: string`(기본 현재 문자열)을 더한다. 기존 호출부는 인자가 없으므로 동작이 그대로다. 기본 템플릿은 `variables`에 그 템플릿의 레지스트리 변수 + 커스텀 변수만, `allowCustom={false}`로 넘겨 같은 `Badge` 칩 줄을 얻는다.

**`TemplateEditor` 변경분**: 상태(`name`/`content`/`variables`/`detectedKeys`)·감지 `useEffect`·`handleSave`·`handleVariableChange`·`chipVariables` 메모는 **한 줄도 바꾸지 않는다**. render 본문에서 3~4번 블록을 `<TemplateContentEditor …/>` 한 개로 치환하고, ref를 `chipEditorRef`에서 코어 handle로 바꾼다. 팝오버 조회 대상이 `variables`에서 `chipVariables`로 넓어지지만, 본문에 실제로 있는 키는 감지 effect가 항상 `variables`에 넣고 `chipVariables`는 그 앞부분이 `variables`이므로 `find`가 같은 객체를 돌려준다 — 동작 동일.

### 4.3 organism — `frontend/src/components/app/system-admin/SystemTemplatesManager.tsx`

`docs/ui-rules.md` §8.2 스캐폴드(단일 시스템 정의 항목형 `ContractAutomationsManager`에 가까움)를 복제해 만든다. props: `{ dataComponent: string; initialTemplateKey?: SystemTemplateKey }`.

**목록(`ListPanel`)**
- `title="메시지 템플릿"`, `subtitle="고객에게 보내는 기본 메시지의 문구와 변수를 관리합니다"`. 탭·검색·`headerActions` 없음(시스템 정의 9종, 생성/삭제 없음).
- `useSystemTemplates()` 결과를 `SYSTEM_TEMPLATE_KEYS` 순서로 정렬해 `AnimatedSlotList` 행으로 그린다. 행: `icon`(템플릿 키 → lucide 아이콘 매핑; 메시지 페이지 `BUILTIN_TEMPLATES`와 같은 아이콘을 쓰되 organism 안의 `Record<SystemTemplateKey, LucideIcon>`으로 둔다), `title=name`, `subtitle="필수 변수 N개 · 최근 수정 MM.DD"`(`requiredVariables.length`, `updatedAt`). `status` 슬롯 없음.
- 로딩: `isLoading` + `loadingCount={9}`; 오류: `ListEmptyState message="템플릿을 불러오지 못했습니다."`.

**상세(`DetailPanel`)**
- 선택 없음: `DetailEmptyState icon={MessageSquareText} message="왼쪽 목록에서 템플릿을 선택하세요"`.
- 선택 시 `title=name`, `subtitle=description`, `tabs=DetailTabs([{key:"edit",label:"템플릿 편집"},{key:"preview",label:"미리보기"}])`.
- footer(`Button`만, 보조 → 주 순서): `[버전 기록]`(=`<VersionHistory templateKey onRollback={resetDraftToServer} />`, 트리거가 outline `Button`) `[되돌리기]`(outline, `!isDirty`면 disabled) `[저장]`(positive, `!isDirty || !clientValid || isPending`면 disabled, pending 시 "저장 중...").

**편집 탭** — 탭 본문은 §4.2 코어 한 개다.

```tsx
<TemplateContentEditor
    ref={editorRef}
    id="system-template-content"
    dataComponent={`${dataComponent}_editor`}
    quickInsert={<VariableInserter variables={insertableVariables} allowCustom={false}
                    dataComponent={`${dataComponent}_editor_inserter`}
                    onInsert={(key) => editorRef.current?.insertVariable(key)} />}
    content={draft}
    onContentChange={handleDraftChange}
    variables={allowedVariables}
    hint={validation.messages.length > 0 ? <검증 힌트 목록/> : null}
/>
```

- `allowedVariables`: 레지스트리 변수 + 기존 커스텀 변수를 `MessageTemplateVariable`(`{ key, label, type: "text", required }`)로 매핑한 목록 **만**. 지점 프리셋(`PRESET_VARIABLES`)은 넘기지 않는다.
- `insertableVariables`: 같은 목록의 `{ key, label }`. 필수 변수는 라벨 앞에 `*`, 커스텀 변수는 `커스텀 · ` 접두. `allowCustom={false}`이므로 "커스텀 변수" 추가 칩은 없다.
- `onVariableChange`를 넘기지 않으므로 칩을 눌러도 읽기 전용 정보만 뜬다(§4.2). 변수 설정 카드 목록과 Tip `Alert`는 렌더하지 않는다.
- 바이트 안내와 `MAX_BODY_LENGTH` 초과 문구는 코어가 지점 템플릿과 똑같이 그린다.
- 클라이언트 검증(저장 버튼 게이트, 서버 검증의 선반영)은 organism이 계산해 `hint`로 넘긴다: `extractVariables(draft)` 기준으로 (a) `required: true`인 레지스트리 변수 중 본문에 없는 것 → "필수 변수 누락: {{key}}", (b) 허용 목록(레지스트리 ∪ 커스텀)에 없는 변수 → "정의되지 않은 변수: {{key}}", (c) `/\{\{(?![^{]*\}\})/` 매치 → "닫히지 않은 {{ 가 있습니다". 문구는 서버 메시지와 동일하게 맞춘다. 서버 400은 응답 `errors[].message`를 합쳐 destructive 토스트로 보여준다.

**저장/되돌리기/동기화**
- `useUpdateSystemTemplate().mutate({ key, content: draft, customVariables: template.customVariables ?? [] })` — 기존 커스텀 변수를 **항상** 함께 보낸다(§2 함정). 성공: `isDirty=false`, 토스트 "템플릿을 저장했어요". 실패: 토스트 "템플릿을 저장하지 못했어요"(서버 메시지 있으면 그것).
- 되돌리기: `draft = template.content`, `isDirty=false`.
- 선택 변경 시 draft를 새 템플릿 값으로 리셋(§2.6 규칙). 쿼리 데이터가 갱신되고 `!isDirty`면 draft를 서버 값으로 동기화(롤백/초기화 후 반영 경로).
- 편집 중 다른 템플릿을 고르면 변경 사항을 잃는다. v1에서는 이탈 경고 없이 §2.6 규칙대로 리셋한다(경고 다이얼로그는 범위 밖).

**미리보기 탭**
- `<TemplatePreview content={draft} variables={allowedVariables} />` — 변수를 `[라벨]`로 치환한 결과와 바이트 수. 편집 탭의 초안을 그대로 반영한다.

**DOM 주석**: 모든 v3 컴포넌트에 `data-component={component("…")}` (`DATA-COMPONENT-CONVENTION.md`). 빈 상태/선택 상태 `DetailPanel`은 `detail-panel-empty` / `detail-panel`.

### 4.4 메시지 페이지 링크 — `messages/page.tsx`

- 기본 템플릿 상세(`isBranchTemplate === false`)에서 `isOwner`일 때만 `HeaderActionButton icon={Pencil} label="관리자 페이지에서 수정" href="/system-admin?section=templates&template=<selectedBuiltinSystemKey>"`를 상세 헤더의 `trailing` 자리(이미 다른 요소가 있으면 그 옆)에 둔다. 오너가 아니면 렌더하지 않는다(부제 문구는 그대로).
- 페이지 diff는 링크 한 요소로 제한한다.

### 4.5 구형 라우트 정리

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

**회귀 먼저**: `template-editor.tsx`에는 지금 테스트가 없다(§2). 코어를 빼내기 **전에** `frontend/src/components/app/my-templates/__tests__/template-editor.test.tsx`를 먼저 쓰고 통과시킨 뒤 리팩터링한다 — 그래야 "동작 변화 없음"이 주장이 아니라 확인이 된다. (1) `initialData`를 주면 이름·본문이 채워지고 빠른 삽입 칩이 프리셋 10종 + "커스텀 변수"로 보인다, (2) 프리셋 칩 클릭 시 칩 에디터 handle의 `insertVariable`이 그 키로 호출된다, (3) 본문에 `{{name}}`이 들어가면 변수 설정 카드가 생기고 카드에서 라벨을 바꾼 값이 저장 payload에 실린다, (4) 저장 클릭 시 `updateTemplate`이 `{ id, request: { name, content, variables } }`로 호출되고 성공 콜백에서 `/messages/templates`로 이동한다.

- `frontend/src/components/app/my-templates/__tests__/template-content-editor.test.tsx` (신규 코어): (1) `onVariableChange`가 있으면 칩 클릭 시 편집 가능한 `VariableConfigurator`(라벨 입력)가 열린다, (2) `onVariableChange`가 없으면 같은 클릭에 읽기 전용 정보만 뜨고 입력 요소가 없다, (3) 바이트 푸터가 90바이트 경계에서 SMS/LMS 문구를 바꾸고 `MAX_BODY_LENGTH` 초과 시 경고로 바뀐다, (4) `quickInsert` 슬롯이 렌더되고 ref의 `insertVariable`이 칩 에디터 handle로 위임된다.
- `frontend/src/components/app/system-admin/__tests__/SystemTemplatesManager.test.tsx` (`TriggerRulesManager.test.tsx`의 react-query 모킹 방식): (1) 모킹된 9종이 순서대로 행으로 렌더된다, (2) 행 선택 시 편집 탭에 본문이 로드되고 빠른 삽입 칩이 레지스트리+커스텀만이다(프리셋 "연락처" 없음), (3) 본문 변경 → 저장 활성 → 저장 시 `update`가 `{ key, content, customVariables: 기존값 }`으로 호출된다, (4) 필수 변수를 지우면 누락 힌트가 뜨고 저장이 비활성이다, (5) `initialTemplateKey`가 주어지면 그 템플릿이 선택된 채 열린다.
- `OwnerAdminConsole.test.tsx` 확장: 섹션 내비에 "메시지 템플릿"이 있고 클릭 시 organism이 마운트된다; `?section=templates&template=GREETING`이면 초기 섹션이 templates이고 organism에 키가 전달된다.
- `messages/page.test.tsx` 확장: 오너면 "관리자 페이지에서 수정" 링크가 올바른 href로 보이고, 오너가 아니면 없다.
- 리다이렉트 페이지: `redirect` 호출 인자 단위 테스트 1건(선택).
- 게이트: `npm run type-check`, `npx eslint <변경 파일>`, `npx jest src/components/app/system-admin src/app/(protected)/messages`, `pnpm lint:ui-architecture`(기준선 감소만 허용).

## 8. 변경 파일

| 파일 | 변경 |
|---|---|
| `frontend/src/components/app/my-templates/template-content-editor.tsx` | 신규 공용 코어 |
| `frontend/src/components/app/my-templates/__tests__/template-content-editor.test.tsx` | 신규 |
| `frontend/src/components/app/my-templates/template-editor.tsx` | render 본문을 코어 호출로 치환(동작 변화 없음) |
| `frontend/src/components/app/my-templates/__tests__/template-editor.test.tsx` | 신규 회귀 테스트(리팩터링 전에 작성) |
| `frontend/src/components/app/my-templates/variable-inserter.tsx` | 선택적 `variables`/`allowCustom`/`dataComponent` prop 추가(기본값은 현재 동작) |
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
- **지점 템플릿 목록 페이지의 인라인 상세**(`messages/templates/page.tsx`의 `BranchTemplateDetail`, raw `<input>`/`<textarea>`) — 이건 `TemplateEditor`가 아닌 별개의 간이 편집기다. 공용 코어로 바꾸면 "동작 변화 없음"을 넘는 UI 변경이 되므로 이번 사이클에서 건드리지 않는다.
- `TemplateEditor`의 기존 동작 개선(프리셋 `prompt()` 제거, 저장 후 이동 경로 변경 등) — 리팩터링은 동작을 옮기기만 한다.

## 10. 계획에서 확정할 검증 포인트 (블로커 아님)

1. `OwnerAdminConsole`이 `useSearchParams`를 쓰려면 Suspense 경계가 필요한지(Next App Router 정적 렌더 경고) — 페이지가 이미 클라이언트 컴포넌트를 마운트하므로 필요 시 `page.tsx`에서 `Suspense`로 감싼다.
2. `VariableChipEditor`가 `variables`에 없는 `{{key}}`를 어떻게 렌더하는지(칩 vs 텍스트) — 검증 힌트가 어차피 잡지만 시각 확인.
3. `DetailPanel` footer에 `VersionHistory`의 Sheet 트리거 `Button`을 두는 것이 §8.3 "footer는 Button만" 규칙에 부합함을 리뷰에서 확인.
4. `data-component`를 리터럴이 아닌 prop으로 받는 공용 코어가 `data-component/require-data-component`(`banLegacyFormat: true`) 규칙을 통과하는지 — v3 컴포넌트들이 같은 방식이므로 통과할 것으로 보지만 eslint로 확인한다. 통과하지 못하면 코어가 `dataComponent` prop을 그대로 붙이는 대신 소비처가 래퍼에 다는 형태로 바꾼다.
5. `VariableChipEditor`의 Tiptap 확장이 `variables` 배열 교체에 반응하는지 — organism은 템플릿을 바꿀 때마다 새 `allowedVariables` 배열을 넘긴다. 반응하지 않으면 선택 키를 `key` prop으로 주어 재마운트한다.
