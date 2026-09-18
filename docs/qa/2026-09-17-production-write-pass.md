# 운영 쓰기 경로 QA — 2026-09-17 후속

## 현재 상태

- 사용자가 QA 지점의 일시 활성화와 공개 지점 목록 노출을 명시 승인했다.
- QA 지점 `QA 검수용 20260917` / `qa-20260917` / `93d0f6a3-89af-422d-b1ae-9d906936c472`를 일시 활성화해 검수한 뒤 **비활성으로 원복했고, 새로고침 후 운영 중 스위치 0을 확인했다.**
- 이후 PC 지점 선택 3페이지 전체와 모바일 지점 선택 목록에서 QA 지점이 제외된 것을 확인했다.
- 두 검수 세션을 기존 인천 아이미래로 지점으로 복귀시켰다. PC 고객 목록에서 정확한 QA 고객명으로 검색해 결과 없음까지 확인했다. 임시 화면 크기를 해제하고 이번 검수 탭을 닫았다.
- QA 제공인력 `149` / `QA 검수 제공인력 20260917` 생성 완료. 이름 변경과 연수구 추가 저장→새로고침 후 유지 확인→원래 이름과 남동구로 원복→상세 재진입 검증을 수행했다. 스탠다드·배정 불가 유지, 담당 고객과 근무 내역은 0건이다.
- QA 고객 생성은 PC에서 중복 오류로 거절됐다. 직후 PC 새로고침에서 지점이 QA에서 기존 지점으로 돌아가 PC 쓰기 검수를 중지했다. 모바일 고객 등록은 3단계까지 확인한 뒤 최종 등록 없이 닫았다. 모바일 새 조회에서 QA 고객 0명 확인. 계약 생성/발송은 수행하지 않았다.
- 연락처는 대화에서 승인된 수신처만 사용한다. 문서에는 실제 연락처를 기록하지 않는다.
- 수정 PR #708은 draft이며 병합/운영 배포하지 않았다. 후속 도메인 배포 조회에서 PC·모바일 운영 프론트가 `c0f16595a34f189260f5a52e4d79dcc3fff3838c`임을 확인했다. 백엔드 런타임 SHA는 미확인이다.

## 새 발견

### BRANCH-005 — 모바일에서 선택 이메일이 비어 있으면 지점 수정 실패

- 운영 모바일 오너 관리자에서 QA 지점의 운영 중 스위치만 변경하고 저장.
- PATCH 지점 요청이 HTTP 400, `VALIDATION_FAILED`, `/email`의 `INVALID_FORMAT`으로 거절됐다.
- 폼에는 실패 원인을 확인할 수 있는 안내가 남지 않았고 스위치는 켜진 상태여서 저장 성공으로 오인할 수 있다. 새로고침하면 비활성으로 돌아왔다.
- 승인된 테스트 이메일을 입력하고 다시 저장한 후 새로고침했을 때 활성화 유지 확인.
- 소스 원인: 모바일은 빈 이메일을 빈 문자열로 전송하고 backend의 선택 `IsEmail` 검증은 빈 문자열을 거절한다. backend 서비스는 null을 통한 기존 이메일 지우기를 지원한다.
- 필요한 수정: 빈 이메일을 null로 전송하고 실패 원인을 폼에 표시하며 입력을 유지한다. 운영 수정은 아직 미배포다.
- 수정 커밋 `ca3b272c5f917a8c02980f02a49de88ae5e31423`: 입력 정규화와 폼 오류 유지, 회귀 테스트 6개. 모바일 전체 260 suites / 1775 tests, typecheck, lint(0 errors / 기존 378 warnings), UI architecture 통과. 로컬 build는 필수 `NEXT_PUBLIC_API_BASE_URL` 부재로 실패했으며 [동일 SHA CI](https://github.com/jaino-song/babyjamjam-admin/actions/runs/35212201234)의 type/lint/test/build는 통과했다. 독립 검토 차단 지적 없음.

### TENANT-001 — PC QA 지점 선택 후 기존 지점으로 복귀

- 일반 카카오 로그인 후 지점 선택 3페이지에서 QA 지점 선택. 대시보드와 고객 목록 헤더가 QA 이름, 고객 0명으로 표시됐다.
- PC 새 고객 폼에서 승인 번호 중복 검사가 등록 가능으로 표시됐다. 가상 생년월일/주소, 제공인력 미지정, 메시지 자동 전송 OFF 상태로 생성 1회 클릭.
- 최종 요청은 중복 연락처 오류로 거절되고 입력 유지. 폼에서 연락처를 비웠다가 동일 번호로 다시 검사한 GET 응답은 HTTP 200, `exists:true`.
- 취소 후 목록을 새로고침하자 헤더가 기존 `인천 아이미래로` 지점으로 바뀌었다. 원인 확정 전 추가 PC 데이터 저장/발송을 중지했다. 최초 POST의 네트워크 기록은 확보하지 못했으므로 저장 대상 지점을 단정하지 않는다.
- 코드에서 중복 사전검사 프록시가 서버 오류를 `exists:false`로 바꾸는 별도 문제도 확인했다. 이 코드 결함이 이번 관찰의 원인인지는 아직 미확정.
- QA 재선택 직후와 시간 경과 뒤 두 번의 PC 새로고침은 QA 지점을 유지했다. 재현이 일정하지 않으며 원인 미확정이다. 두 화면의 인증 쿠키는 각 호스트에만 적용되고 중복이 없어 PC/모바일 간 직접 쿠키 충돌을 근거 없이 원인으로 삼지 않는다.
- 소스의 세션 검증은 token의 지점과 저장된 세션 지점이 다르면 거절한다. 따라서 단순 refresh 경합만으로 원인을 확정하거나 인증 코어를 수정하지 않았다.

### CLIENT-007 — 중복 확인 서버 오류를 등록 가능으로 바꾸는 프록시

- PC 고객 check-phone 경로가 upstream 오류를 raw 로그로 기록하고 HTTP 200 `exists:false`로 응답했다. 이번 운영 중복 오류와의 인과관계는 미확정이지만 실패를 등록 가능으로 처리하는 코드 결함은 확정했다.
- `94c5b3567` + `b8ce1cf7c`: 기존 공통 오류 처리기로 401/403/500을 보존하고 응답과 로그를 정제하며 조회 실패 문구를 사용한다. 정상 true/false 응답과 기존 인증 게이트는 유지한다.
- 회귀 테스트 RED 3 failed / 3 passed → GREEN 6 passed. PC 전체 253 suites / 1780 tests, typecheck, local production build, lint(0 errors / 기존 1117 warnings) 통과.

### EMPLOYEE-006 — 수정 후 열린 상세 화면에 이전 값 잔류

- 모바일 QA 제공인력 149의 이름과 근무 지역을 저장하면 목록은 최신 값으로 바뀌지만 열린 상세 제목·이름·지역은 이전 값으로 남았다. 새로고침하고 다시 열었을 때 변경 값이 보여 실제 저장과 화면 갱신 문제를 분리했다. 원복 후에도 같은 현상 확인.
- `6117cd7e8`: 필터링 전 최신 직원 목록에서 선택 ID의 값을 찾아 상세와 수정 동작에 전달한다. 검색 결과에서 사라져도 상세는 최신 값으로 유지하고 현재 탭을 보존한다.
- 회귀 테스트 RED 1 failed / 2 passed → GREEN 3 passed. 모바일 전체 260 suites / 1776 tests, typecheck, UI architecture, 변경 파일 lint(0 errors / 기존 10 warnings) 통과.
- 독립 검토 차단 지적 없음. 외부 삭제로 목록에서 완전히 제거된 직원의 이전 상세를 남기는 기존 fallback은 별도 잔여 한계다.

### CLIENT-UI-001 — 필수 항목 안내 불일치

- PC 새 고객 1단계는 이름/생년월일/연락처/주소 4개를 요구하지만 별표는 이름에만 표시됐다. 생년월일·주소가 비어 있으면 다음 버튼이 비활성이고, 하단에는 총 입력 개수만 표시된다.
- 가상 생년월일과 주소를 채우면 다음 단계 진입 가능. 작업 브랜치에서는 앞선 `aabc5138b`, `33a2b001a`가 두 폼의 필수 표시를 이미 보완했다. 운영에는 해당 수정 반영을 확인하지 못했다.

## 데이터 격리와 자동 발송

- 고객/직원 연락처 중복은 지점별·엔터티별 범위이므로 같은 승인 번호를 QA 고객 1명과 QA 직원 1명에 사용할 수 있다.
- 고객 생성의 자동 메시지는 기본 활성이다. PC 폼에는 자동화 스위치가 있지만 모바일 생성 폼에는 직접 끄는 입력이 없다. 첫 고객 생성은 자동 발송 조건을 확인한 뒤 진행한다.
- 직원은 초기 배정 불가로 생성하고 주 제공인력 없이 고객을 생성해 일정/발송의 예기치 않은 연계를 피한다.
- 고객 삭제는 실제 삭제이며 연결 기록이 있으면 거부된다. 폐기 대신 격리/중단을 기본 정리 방식으로 사용하고 복구 불가 삭제는 실행 전에 별도 확인한다.
- 직원 수정은 프로필 필드를 보내면 배정 알림 작업을 재조정할 수 있다. 이번 직원은 담당 고객/일정 없음, QA 지점 발신번호 미신청을 UI로 확인했다. 실제 고객/직원은 변경하지 않았다.
- 고객 생성은 자동화를 꺼도 같은 번호의 계약서를 연결할 수 있다. 다른 지점에 귀속된 문서는 제외되지만 전역 미연결 문서의 조건부 연결이 있어 운영 후보 조회가 필요하다. 일반 QA 지점 계약 목록은 전역 문서를 제외하고, 본점 검색에도 전화번호 검색이 없어 UI만으로 미연결 후보를 배제하지 못했다.
- 기존 로컬 backend 환경으로 읽기 전용 건수 조회를 시도했으나 QA 지점 자체가 없어 운영 증거로 사용하지 않았다. 환경 파일은 변경하지 않았다. 운영 DB의 승인된 읽기 경로로 후보 건수를 확인하기 전 추가 고객 생성/계약 발송은 보류한다.

## 최종 구현 검증과 재개점

- 구현 HEAD `6117cd7e8bffb7cca5087ca8229dc006fb61e99e`의 [Frontend CI](https://github.com/jaino-song/babyjamjam-admin/actions/runs/35213717008), [Mobile CI](https://github.com/jaino-song/babyjamjam-admin/actions/runs/35213717098), Mobile Unit CI, Shared Contracts CI 모두 통과. 새 운영 브라우저 재검수나 실제 외부 수신 증거를 뜻하지 않는다.
- 인증·권한 코어, 스키마, 의존성, 환경 파일 변경 없음. 추가 코드의 시크릿/위험 실행 패턴 0건. 기존 의존성 audit 0건 이후 의존성 변경 없음. raw 오류 로그를 제거하고 정제된 오류 처리기를 재사용했다.
- PR #708 draft 유지, 병합/배포 없음. 수정 후 운영 재검수는 미실행.
- 재개: PC 지점 복귀 원인 재현/요청 지점 확인 → 운영의 미연결 계약 후보 읽기 확인 → QA 지점 일시 활성화 → QA 고객 등록·수정·상태/일정·계약/수신 흐름 → 지점 비활성 원복. 전체 검수 완료로 판정하지 않는다.

## 후속: 배정 상태와 대시보드 검수

### 검수 버전과 범위

- 운영 PC alias: `dpl_6vTvMS6oepDjNK2jBgfY2mtKm7Cz`, 모바일 alias: `dpl_SXMbejE7Pam1YGb4yfykNMSASx6i`. 두 배포 모두 READY / 소스 `c0f16595a34f189260f5a52e4d79dcc3fff3838c` 확인. PR #708 배포를 뜻하지 않는다.
- 공개 backend `/health`는 HTTP 200 / `status:ok`. 버전 필드가 없어 backend SHA 증거로 사용하지 않는다.
- 승인된 QA 지점을 일시 활성화하고 QA 제공인력 149만 사용했다. 새 고객·계약·발송·삭제 없음.

### EMPLOYEE-007 — 배정 가능 상태 저장과 원복

- 모바일 390×844, QA 지점의 유일한 제공인력에서 `다음 근무 배정 가능` OFF → ON 저장.
- 목록 배정 가능 1 / 배정 불가 0 반영, 새로고침 후 유지. 배정 불가 필터는 명시적인 빈 안내, 배정 가능 필터는 QA 직원 1명 표시.
- 열린 상세가 이전 배정 불가를 유지하는 EMPLOYEE-006을 추가 재현했다. 재조회한 상세는 배정 가능으로 정확하게 표시돼 저장 실패와 구분된다. 기존 수정의 운영 미배포 상태다.
- ON → OFF 저장 후 새로고침해 배정 가능 0 / 배정 불가 1 확인. 이름·남동구·스탠다드 유지.
- 연락처 입력을 잘못된 값으로 바꾼 폼은 오류 표시·저장 비활성 확인 후 취소했다. 전화 입력의 DOM/AX 값이 시각 값과 달라 정확한 길이별 검증은 통과 판정하지 않는다. 재진입에서 원래 연락처 유지 확인.

### DASH-002 — 빈 현황 안내 누락과 조회 실패의 0건 표시

- 운영 QA 지점 모바일 390×844에서 최근 현황 카드가 큰 빈 영역으로 남음. 전체/조치 필요 필터에 빈 안내 없음. 실제 고객·요약 조회는 HTTP 200을 관찰했다. 운영 장애를 유발하지 않았다.
- 별도 소스 결함: 고객·요약 조회 hook은 오류를 반환하지만 페이지가 `isError`를 읽지 않아 실패 시 빈 배열·추정 0건을 보여준다. 경로 error boundary는 이 조회 오류를 잡지 못한다.
- 수정: 정상 빈 결과는 전체/조치 필요/시작 예정/종료 예정별 안내를 표시한다. 목록 조회 실패는 숫자 대신 `—`와 오류/재시도, 요약 조회 실패는 추정 수치 대신 별도 오류/재시도를 표시한다. 서로 성공한 영역은 계속 사용할 수 있다.
- 기존 `ListEmptyState`, `Alert`, `Button`, `StatsBar`, `ListCard`, `ListRowsSkeleton` 조합. 새 custom UI 컴포넌트, page-local 컴포넌트, page의 시각 스타일 추가 없음.
- 회귀 RED: 5 failed / 2 passed. 최종 화면·페이지 상태 테스트 10 passed; 전체 모바일 262 suites / 1786 tests passed. typecheck 및 UI architecture 통과. 변경 파일 lint 0 errors / 기존 경고 1개.
- 로컬 production build는 기존 `NEXT_PUBLIC_API_BASE_URL` 미설정으로 실패. 환경 파일을 바꾸거나 값을 발명하지 않았다. 구현 `d161f3070`의 [Mobile CI](https://github.com/jaino-song/babyjamjam-admin/actions/runs/35223082803)는 type/lint/test/build까지 통과했다. 이번 실행의 실제 backend Playwright job은 skipped이며 이전 E2E 증거로 대신하지 않는다. 전체 모바일 lint는 0 errors / 기존 378 warnings.
- 실제 Chrome의 인증된 로컬 QA 경로 `127.0.0.1:3102/dashboard`, 390×844에서 빈 안내 screenshot/DOM/computed style 확인: `mobile_dashboard_page_content_list-card_body_empty`, display block, font-size 13.6px, width 322px.
- 로컬 탭에서 고객·요약 요청을 임시 차단해 오류 화면을 직접 확인했다. 요약/목록 오류의 폰트 14px, 요약 영역은 기존 stats-grid 여백 적용. 차단 해제 → 목록 다시 시도 → 목록만 복구/요약 오류 유지 → 요약 다시 시도 → 둘 다 정상 복구 확인. 차단·viewport 해제, 검수 탭 닫음. 운영 장애나 외부 발송 없음.
- 보안 점검: 추가 diff의 시크릿/위험 실행 패턴 0, 환경 파일 ignore 확인, 의존성 audit 0건. 인증/권한·스키마·의존성·환경 파일 변경 없음.

### 정리 및 남은 차단

- QA 제공인력은 배정 불가로 원복했다. 지점도 비활성 저장 → 새로고침 스위치 0 → 모바일 지점 선택 목록에서 제외 확인. 기존 인천 지점으로 이동을 완료하고 검수 탭을 닫았다.
- PC 고객 중복 요청은 쿠키를 쓰지 않는 경로다. 지점 선택과 인증 갱신의 쓰기 경로를 확인했지만 TENANT-001의 원인은 아직 미확정이다. 인증 코어 변경 없음.
- 본점 계약 목록은 20개 단위/총 64개 응답과 다음 페이지 로딩을 확인했다. 목록 projection에는 전화·상세 동기화 정보가 없고 산모 계약 section은 템플릿 필터가 있으므로, 모든 페이지를 읽더라도 자동 연결 후보 없음의 증거가 되지 않는다.
- 저장된 운영 runbook에는 DB identity/status/SELECT 1 경로만 있고 승인된 임의 후보 조회 경로는 발견하지 못했다. 로컬 DB를 운영으로 간주하거나 제한된 서버 역할을 우회하지 않았다. 운영 후보 조회와 지점 원인 확인 후 고객 저장·계약 전송 QA를 재개해야 한다.
- 추가로 기기에 이미 인증된 Supabase CLI를 발견해 프로젝트 목록 조회까지 수행했다. 연결된 계정의 프로젝트와 로컬 backend 프로젝트는 다르다. 임시 작업 디렉터리의 읽기 전용 schema probe는 IPv6 연결 불가로 실패해 프로젝트의 운영 여부나 QA 지점 존재를 검증하지 못했다. 연결을 성공한 운영 DB 조회로 기록하지 않는다. 추가 인증 발급·권한 변경·DB 변경 없음.
- 전체 QA 완료, 수정 운영 반영, 실제 수신 완료로 판정하지 않는다.

## 추가 읽기 전용 운영 검수 — 피드백·고객 필터·템플릿

### 개발 DB 검수 재개

- 사용자가 개발 DB 검수를 지정했다. task backend 연결이 dev checkout의 DATABASE_URL과 동일함을 값 노출 없이 비교했다. 상속된 DATABASE_URL override 없음.
- 로컬 backend는 프로세스 한정 `SCHEDULERS_ENABLED=false`, PC는 `pnpm qa:fe -- --port 3100`으로 실행. `localhost:3100`에서 자동 로그인과 지점 전환 확인. `127.0.0.1` 세션은 로그인으로 이동했으며 원인 확정하지 않음.
- 기존 개발 전용 `QA 로컬 검수 20260917` (`qa-local-20260917`, `48f9eaf2-7ca9-4e64-8148-9adc3f697aa1`)을 임시 활성화하고 선택했다. 운영 지점 변경 없음.
- 개발 DB 읽기 조회: QA 고객 0명, 지정 테스트 번호의 QA 중복 0명, ready/not-ready를 포함한 계약 자동 연결 후보 상한 0건. 고객 폼 1단계까지 진입.
- 첫 이름 입력 시 브라우저 연결이 중단됐다. 다음 상태 조회에서 다른 확장 프로그램 UI가 열려 Chrome 자동화가 차단됐다는 응답을 받았다. 입력/고객 생성 완료로 판정하지 않는다. 재개 지점은 고객 기본 정보 입력이며 QA 지점은 아직 활성 상태다.
- 이후 사용자 확인 및 Chrome 화면 조회에서 열린 팝업은 확인되지 않았다. 브라우저 연결 초기화와 AX `setValue` 방식으로 입력을 재개했다. 확장 프로그램 팝업이 실제 원인이라고 확정하지 않는다.
- 개발 QA 고객 162 생성 성공(예약 전, 미배정, 서비스 금액/일정 미입력, 자동 전송 OFF). 운영 고객 생성 또는 실제 발송 증거가 아니다.
- CLIENT-EDIT-BLANK-001: 이름/주소만 수정해도 PATCH 400과 일반 형식 오류 2개 발생. edit payload가 비어 있는 fullPrice/actualPrice를 빈 문자열로 전송해 금액 검증에서 거절됨. create와 동일하게 비어 있는 금액을 null로 정규화했다(바우처 grant 포함).
- 수정 전 회귀 1 failed / 8 passed. 수정 후 관련 16 tests, 전체 frontend 253 suites / 1781 tests 통과. typecheck, 변경 파일 lint, UI architecture 통과. 기존 폼을 그대로 사용하며 새 UI/스타일/auth/schema/dependency/env 변경 없음.
- 실제 개발 브라우저에서 동일 폼 재저장 성공, 목록/상세 반영 확인. DB에서 QA 지점 일치, 수정된 이름/주소 저장, 금액 null 유지 확인. 개발 지점/고객은 후속 계약 검수를 위해 유지한다. 전체 QA 및 운영 수정 반영은 미완료다.
- frontend production build 통과, 의존성 audit 취약점 0. 변경 diff에 시크릿·외부 실행·권한 변경 없음. 빌드 통과는 배포 성공을 의미하지 않는다.

- Chrome 운영 PC, 기존 인천 지점에서 읽기 전용으로 실행. QA 지점 활성화, 고객/직원 변경, 메시지 발송 없음.
- ADMIN-FEEDBACK-001: `/admin` 전체/긍정적/부정적 필터에 `피드백이 없습니다` 표시. 검색 열기 → 존재하지 않는 QA 검색어 입력 → `검색 결과가 없습니다` 확인, 검색어 지우기/닫기. 실제 피드백 0건이므로 행 상세와 대화 내용은 미검수. 데스크톱 screenshot에서 빈 목록/상세 안내와 레이아웃 확인.
- CLIENT-FILTERED-001: `/clients/filtered?filter=bogus`는 `잘못된 필터입니다` 표시. `filter=incomplete-contracts`는 `계약서 미완료` 제목과 이름/시작일/계약서 표 렌더, 로딩 후 결과 행 존재 확인. 고객 행을 수정하거나 식별 정보를 기록하지 않음. `닫기` 클릭 후 `/` URL 확인. 요청 미발생 여부는 네트워크로 확인하지 않았으므로 판정하지 않음.
- MESSAGE-TEMPLATE-READ-001: `/messages/system-templates` → `/messages/templates` 리다이렉트 확인. 미선택 안내, 기존 템플릿 선택 후 이름/내용 렌더, 변경 전 `저장` 비활성 확인. screenshot에서 입력/본문/버튼 잘림 없음. `돌아가기` 후 `/messages` URL과 메시지 전송 화면 렌더 확인. 생성/저장/삭제는 실행하지 않음.
- 위 항목은 해당 조회/탐색 하위 시나리오만 통과다. 각 기능의 쓰기·오류·작은 화면 전체 통과를 의미하지 않는다.
- 운영 DB 연결 차단 추가 조사: Supabase CLI v2.95.4 공식 소스에서 `db query --linked`의 Management API 호출 전에 root persistent pre-run이 DB 연결 설정/직접 TCP 검사를 수행함을 확인. 관찰된 IPv6 오류는 SQL 실행 전 단계이며 운영 DB 확인 성공이 아니다. 토큰 추출, 새 인증, 권한 확대, CLI 수정/업그레이드는 수행하지 않음. 운영 프로젝트 식별과 계약 자동 연결 후보 조회는 계속 미완료.


## Dev QA continuation — customer validation and template prerequisite

- Environment: local frontend :3100 / backend :3001 against the previously verified dev DB; QA branch `qa-local-20260917`, customer 162 only. Not production proof.
- PASS: editing birthday to `1990-02-30` and saving displays a valid-date error and keeps the dialog open. Cancelling preserves original birthday `1990-01-15` in customer details.
- PASS (empty state only): customer contract tab shows no-contract information; notification tab shows no-send-history information.
- OBSERVED: service-record tab for this unscheduled customer displays unavailable source/history warnings and says to retry later, with no visible retry control. Cause not yet established; do not classify as a confirmed backend defect.
- CONFIRMED PREREQUISITE: dev QA branch has zero document-template rows (dev total two). Contract type selector appears blank without explanation. Source also drops template-query error state, conflating empty and failed results.
- FIX BLOCKED: assigned Luna max worker in `unit-qa-contract-template-states` hit its usage limit. It left an untracked `ContractCreationForm.area-template-states.test.tsx`; no implementation commit or integration, and no passing verification claimed. Preserve for resumption on the same required model.
- OBSERVED: one fresh local settings tab showed Incheon after an earlier QA selection; reselected QA before writes. Root cause remains unverified.
- Remaining: QA area/template and employee fixtures, configured contract wizard/send flow, service-record diagnosis, template-state fix and regression verification, and remaining inventory coverage.


## Dev QA continuation — employee creation/edit and schedule

- Created QA-only employee `QA 개발 직원 20260917` in the dev QA branch using the approved controlled recipient, standard grade, Yeonsu work area, and assignment availability OFF. No send action performed.
- PASS: phone availability check, required-field progress, creation, list count/detail display.
- PASS (persistence through browser reload): renamed to `QA 개발 직원 수정 20260917`; the new name survives reload and detail reselection.
- FAIL EMPLOYEE-DETAIL-STALE: immediately after editing, list shows new name while selected detail title/basic info retain old name; switching tabs does not repair it. Read-only scout traced missing `onSuccess={handleFormPanelSuccess}` on EmployeeDirectoryManager's edit dialog; list refetch alone does not update selectedEmployee local state. No fix integrated yet.
- PASS: empty work-history message. Assigned-customer tab inspected but final empty-state text not separately verified.
- PASS (empty schedule only): calendar loads, selecting Sept 18 updates detail date, list view displays zero records and explicit empty-state message. Populated schedule and mutations remain untested.
- Luna template worker was resumed on the same required model; final result pending at this checkpoint.


## 2026-09-18 continuation — further bounded checks

- PASS: customer duplicate-number message appears for the existing QA recipient; after filling all four required fields, Next remains disabled. Cancelled without creating another customer.
- PASS: consultation read/unread empty filters render explicit empty result.
- PASS (inspection only): file repository empty state and upload dialog open/cancel. Actual upload not executed: owner dialog explicitly says files are shared to all branches.
- PASS: 2026 price table duration/type filters, no-match state, reset (81 data rows), and arithmetic consistency of all 81 rendered rows (total equals subsidy plus copay). This does not validate against official source pricing.
- LIVE EVIDENCE: QA162 service-record overview returned 200; revision history returned 404 repeatedly. Combined with source trace, no-case is being displayed as transient history failure. Local UI-only fix delegated with strict 404 plus successful no-case-overview criteria; 500/network/permission errors must remain errors.
- Template correction review requested final retry entry guard as well as disabled wizard controls. New fixture personal contact/name requested to be replaced with synthetic data before integration.

- STATS local blocker identified: server log contains sanitized `PostHog statistics are not configured`; source throws this when POSTHOG_API_KEY or POSTHOG_PROJECT_ID is absent. UI generic error and retry were exercised, but successful statistics rendering is blocked by local configuration. No env changes performed and no production failure inferred.
- Dev QA employee persistent ID is 132; DB read confirms edited name, availability false, and work area.


## Integrated correction verification — 2026-09-18

- All implementation delegated to Luna max fast/priority in isolated unit worktrees; main reviewed and integrated the final net changes. Execution DELEGATE / Audit SELF: local UI state and display only, no API/auth/schema/persistence contract changes.
- Contract template states: browser confirmed disabled selector plus explicit unconfigured message. Loading/error/retry, stale selection, retry-time mutation blocking and input preservation covered by component tests. No live provider failure was injected.
- Employee detail: browser renamed dev employee132 to `QA 개발 직원 확인 20260918`; list, selected detail title and basic info all changed immediately without reload/reselection. Availability stays false.
- No-case service-record revision history: browser now shows `아직 제공기록지 이력이 없습니다.` for QA162. Existing missing source schedule warning remains truthful. Tests ensure 500/network/401/403/other404 and overview failures are not concealed.
- Integrated frontend verification: 255 suites / 1797 tests PASS; type-check PASS; scoped ESLint 0 errors / 1 existing exhaustive-deps warning; UI architecture gate PASS; production build PASS. Dev frontend was stopped for build and restarted with approved qa:fe launcher afterward.
- Security review: dependency audit reports 0 vulnerabilities; staged added-line checks found no private key/live key/embedded DB URL/unsafe execution/controlled recipient. No dependency, schema, env or auth changes.
- Created dev-only QA area `QA20260917Namdonggu` and one document-template metadata row, linked to existing dev Namdonggu 2-step template. Guarded by verified dev DB fingerprint and QA branch ownership in one transaction. No provider calls or sends. This enables subsequent wizard checks; no contract has been issued yet.
- Evidence logs: `/tmp/bjj-qa-20260918-{tests,types,lint,ui,build}.log`, `/tmp/bjj-qa-20260918-audit.json`.
- No dev/main merge or deployment performed. Full QA remains incomplete: configured contract flows, delivery/PDF, populated schedules/records, mobile parity, role boundaries and broader write cases remain.


## Configured contract wizard continuation

- PASS: QA-owned template loads after metadata fixture creation; existing QA customer search selects customer162 and fills phone/birthday/address; employee132 search fills its phone. No final generation clicked.
- PASS: 2026 A가-1형 / 5 days fills 732,000 total / 659,000 subsidy / 73,000 copay, matching displayed price table. Start Sept21 computes end Sept29. This observed date computation is not independent holiday-source verification.
- PASS: backward navigation preserves voucher prices and employee selection. Enabling second employee blocks Next until selected; searching the primary employee returns no option in secondary selector. Disabling secondary restores progression.
- FAIL CONTRACT-DATE-ORDER: start Sept21 / end Sept20 leaves final generation enabled and no inline error. Read-only trace confirms updateClient occurs before provider dispatch without date ordering guard. Did not click final; restored end Sept29. Delegated front-end early guard + UI feedback to Luna max; independent review required before concluding. API/backend hardening and mobile equivalent remain separate unchecked scope.
- ACCESSIBILITY observation: three rendered step4 date text inputs have empty id, no aria-label and no associated labels. Included local accessible-name correction in date worker scope.
- Contract draft remains unsent; no customer assignment/date/price change from this wizard occurred.

- FAIL CONTRACT-HEADER-1280: at viewport1280x720 in configured wizard step2, title/description shrink to a single Korean character column while stepper consumes remaining header width. Buttons remain visible. Normal1920 view is not proof of responsive correctness. Reproduced via screenshot; viewport reset afterward. Read-only header ownership trace dispatched.


## Contract date/header integrated verification — 2026-09-18

- Execution DELEGATE (Luna max fast/priority); Audit SOL for pre-submission validation and shared header integration.
- Integrated date guard and optional contract-only stacked header at `40dc4e7d2`; independent Sol SHIP for `be033f17d..40dc4e7d2`, with no blocking findings.
- PASS live dev browser: reversed end date, incomplete end date, and nonexistent payment date each display a Korean reason and disable generation; corrected dates clear the error and restore generation. The three date inputs now expose associated accessible labels.
- PASS visual: at 1280x720, after reloading the newly compiled page, contract title/description and all five steps are readable without the former one-character column. Viewport override reset afterward.
- PASS unavailable-employee recovery: clicked generation with QA employee132 unavailable. Actionable activation/other-employee guidance appeared, step4 and all entered dates were preserved. Guarded dev DB read confirmed QA162 start/end/fullPrice/actualPrice remain null. No successful provider issuance or external receipt claimed.
- QA employee132 was then changed to available through its edit form, in the dev QA branch only. List, detail and availability count immediately agree. This prepares subsequent controlled issuance checks.
- Integrated verification at40dc: 256 suites /1807 tests PASS, type-check PASS, UI architecture PASS, production build PASS. Evidence `/tmp/bjj-qa-20260918-dates-{tests,types,ui,build}.log`.
- Sol low accessibility observation (payment error association) corrected by Luna in `c7cf67ec9`; 10 focused tests and typecheck PASS. Correction production build PASS; fresh Sol FINAL SHIP for exact `40dc4e7d2..c7cf67ec9` (correction scope only). Existing broad start/end ARIA error flags and live assistive-technology checks remain outside this correction.
- Remaining includes successful controlled provider issuance, actual recipient delivery/PDF, populated service-record/schedule flows, mobile parity and non-owner role checks. No dev/main merge or deployment.


## Provider template recipient inspection

- Performed authenticated read-only GET of the exact QA-linked provider template with `is_include_config=true`; HTTP200. Credentials and raw member/group identities were not printed or persisted. No create/send request.
- Confirmed workflow includes writer, two participant steps and completion. The latter participant has a pre-specified group recipient (`use_receipient_specified=true`) and mail/SMS/Alimtalk settings enabled; template alerts also enable mail/SMS for that step.
- BLOCKED controlled issue: application payload supplies the controlled customer and non-notifying internal user, but precedence over the provider's fixed group settings is not proven. Need isolated QA provider template or verified provider behavior before issuance. Do not reinterpret the read-only metadata request as a document issue or delivery.


## QA template isolation and requested entity writes — 2026-09-18

- User explicitly authorized QA-only template separation and customer/provider creation/edit using newly supplied controlled contacts. Dev DB identity verified; UI branch remained `qa-local-20260917`. No code, env, auth or schema changes.
- Created external template `QA 전용 산모 계약서 20260918` by cloning source `7a632a0c98a04bf38e678affcb73f815`, preserving source. New id `3868b1fc23aa4013a10e0415636da609`; title prefix QA_TEST. Removed inherited group recipient by making both participant recipients mandatory at send time. Existing single-owner template permissions retained. Saved and released only this QA copy.
- Provider GET verification: enabled/released true; both participant steps have zero fixed recipients, specified-recipient false and outsider-auto-info false. Guarded dev transaction replaced only QA area `QA20260917Namdonggu` doc_template row `225bbc06-f32a-4472-b90f-95e457eff05d`; production bindings untouched. App selector now displays `QA 전용 산모`.
- Created customer163 `테스트 고객` through UI. Synthetic required birthday1990-01-15 and QA-only address used. Before creation, dev mirror search found zero matching-phone documents. Message automation switch OFF before submit.
- Updated customer address to `QA 테스트 전용 수정 주소` and enabled breast-pump rental; save, reload and reselection show both changes retained, original requested name/phone unchanged.
- Created employee133 `테스트 제공인력` through UI with standard grade, Namdong work area and assignment available. Updated grade to best; reload/reselection shows best grade, exact requested name/phone and Namdong area retained.
- Read-only DB verification confirms both new IDs belong to the QA branch; customer address/birthday and employee grade/workArea/availability match UI. No actual contract or message send invoked in this pass. Remaining broad QA is not complete.


## Actual send attempt — 2026-09-18

- User explicitly requested actual contract/SMS QA. Created contract from customer163 detail with QA template, employee133, 2026 A가-1형 5days, start2026-09-21/end2026-09-29/payment2026-09-18. Clicked final generation once.
- FAIL/UNCONFIRMED: direct dispatch-headless reached top-level provider send then no confirmation popup; terminal SDK callback timed out after30s. UI displays unknown creation status with retry. No repeated send invoked.
- Provider document management filtered exact QA template with all statuses selected shows total0. Dev DB customer163 document mirrors=[] and create jobs=[]. This does not prove remote non-delivery after an ambiguous send attempt.
- The direct headless path ran even with SCHEDULERS_ENABLED=false; queued job workers remain disabled. Customer service fields were updated before the provider attempt (visible behind modal).
- SMS QA branch is unapproved. Settings requires Aligo terms/privacy third-party consent plus sender confirmation before application; action-time confirmation requested and pending. Do not silently override approval status or consent fields.
- Browser contract error and SMS consent screens preserved for continuation. Actual contract delivery, SMS, recipient receipt and document-open checks are still incomplete.

- Dispatch intent read confirms id `96b12943-acde-489c-b2c1-12eae12a6601`, customer163, exact QA template, status `uncertain`, attempt_count1, provider_document_id null, no reconciliation. This is an explicit ambiguity fence, not missing queue processing. Supported owner/admin reconciliation requires verified delivered/not-delivered outcome before another send.

## Controlled SMS dispatch and mobile continuation — 2026-09-18

- User confirmed Aligo terms/privacy/sender-consent submission at action time. Submitted the QA branch application through the UI, then approved that exact branch using the owner administration screen. Reloading messages made the approved send interface available. No global sender setting changed.
- Actually submitted one SMS to each newly approved test contact through the desktop message form. Dev message logs69 and70 are `sent`, provider acceptance `accepted`, with nonempty provider message IDs at03:29 and03:30 KST. This establishes provider acceptance, not final handset receipt; the latter was requested from the user and remains pending.
- FAIL SMS-EDITED-BODY: selected/entered recipient first, replaced the introduction body with explicit QA text, and verified preview68/70characters. Both persisted/provider-submitted bodies remained the original343-character introduction template. The edited preview was not what was sent. Stopped additional sends and assigned a minimal queue-synchronization correction to Luna max in `unit-qa-message-edited-body`.
- Confirmed cause: the current recipient's edited body changes, but an already-queued phone-only recipient retains its old body. Submission uses the queued body. This affects linked-customer and manually entered recipient paths; backend records and forwards the supplied body.
- PASS: cancelled the QA customer's pending Sept21 employee service-record-link dispatch through the confirmation dialog; upcoming count became0, cancellation reason appeared in history, and the cancellation filter showed exactly that record. This also prevents an unintended later send of a local-only URL if schedulers are restarted.
- Contract investigation: provider list API title search `QA_TEST_` for in-progress/completed/rejected returnedHTTP200 and total_rows0 for each; provider document-management UI still showed0 for the exact QA template across all statuses. The uncertain dispatch intent was neither overwritten nor retried. Source and clone both have writer/participant/participant/complete steps; the removed fixed recipient is confirmed, but an SDK step-type incompatibility is not proven.
- Mobile QA used approved `qa:mobile` launcher on loopback3102 with the same dev backend, at390x844. Dashboard and customer detail had readable layout and no observed clipping. This is bounded local evidence, not production/mobile-wide approval.
- PASS: searched customer163, edited its address to `QA 모바일 수정 확인 주소`, progressed through all3steps, saved, and returned to the selected detail with the new address. Guarded dev DB read confirms exact QA branch and saved address.
- PASS: mobile customer message history displayed the actual introduction body and cancelled record. Service-record overview showed0/5 and five scheduled dates; opening the first unwritten visit showed empty record fields.
- PASS: mobile customer edit with endSept20 before startSept21 was rejected with a Korean business reason and retained inputs. DB dates stayed Sept21/Sept29. Restored the draft date and closed without another write.
- Local-only link limitations: mobile service-record editor points to loopback3000 and generated employee link uses a LAN address. External recipient link access was not claimed or tested through those addresses. No env edits, tunnel or proxy introduced.

## SMS edited-body correction verification

- Execution DELEGATE / Audit SOL. Luna max implemented `32e0685f4`, integrated as `205cada2f`. Only the active same-phone queued body updates; existing identity/deselection behavior and unrelated recipients remain unchanged.
- Added five regressions covering phone-only, name-required, selected-customer identity, individualized multi-recipient bodies and duplicate-confirmation payloads. Integration:256suites/1813tests PASS, type-check PASS, scoped ESLint PASS, UI architecture PASS, production build PASS. The first test command had an extra argument separator and found no tests; corrected invocation completed the full passing run.
- Independent Sol FINAL SHIP, high confidence, for exact `b5e69ee6e..205cada2f`; no blocking findings. Security review found no new secret/auth/tenant/schema/env/dependency behavior. The unchanged dependency lock retains the earlier online audit evidence; worker's offline audit is not claimed as a fresh registry audit.
- PASS live after reviewed correction: selected QA customer, then edited body and previewed84characters, then sent once. Dev log71 records exact expected body (`message_body === expected`), customer163 linkage, `sent`/`accepted`, provider message ID present, accepted03:49 KST. Browser history displays the same edited text.
- PASS live manual-phone path: entered the approved employee contact, then edited body and previewed86characters, then sent once. Dev log72 records exact expected body, `sent`/`accepted`, provider message ID present, accepted03:50 KST. Browser history displays the same edited text and resolves the recipient as the test employee.
- Four SMS total were accepted during this pass: two pre-fix introduction bodies and two post-fix explicit QA messages. Post-fix messages explain the preceding introductions were also QA. No further retries or broad sends. Handset receipt remains unconfirmed by the user; current adapter has no terminal-delivery polling API.
- Full QA remains incomplete, including contract issuance/recovery and external document opening/signing, populated record writes, remaining mobile flows, and role boundaries. No dev/main merge or deployment.

## Provider final status, contract recovery and record persistence — 2026-09-18

- Read-only Aligo `sms_list` lookup (official API specification https://smartsms.aligo.in/admin/api/spec.html) returned HTTP200/result_code1, one exact controlled recipient and `sms_state=발송완료` for all four known message IDs corresponding to dev logs69–72. This establishes provider-reported final delivery, not a human read receipt. No additional SMS was sent.
- Contract absence verification was broadened to complete, unfiltered pagination across provider lists01/03/04:41/233/276 entries respectively, all pages consumed, zero exact QA-template matches. These are scanned list entries, not necessarily550 distinct documents. The check occurred more than an hour after the ambiguous attempt.
- Used the supported owner reconciliation endpoint for dispatch intent `96b12943-acde-489c-b2c1-12eae12a6601`, with the above absence evidence and outcome `not_delivered`. HTTP200; current status `reconciled_not_delivered`, provider document ID remains null. Earlier `uncertain` observations above are historical. No blind retry or new contract send occurred.
- Confirmed mapping inconsistency: live source and QA workflow both have writer/participant/participant/complete; application hardcodes institution step3 as SDK06 (reviewer), whereas official embedding documentation identifies participant as05. Whether this mismatch caused the missing send popup remains unproven. Fix design is under independent review; recipient identity and notification suppression must remain unchanged. Source: https://eformsignkr.github.io/developers/help/eformsign_embedding_v2.html .
- FAIL MOBILE-CONTRACT-DATE: at final mobile contract step, start260921/end260920 leaves generation enabled without a date-order error. Invalid payment260230 silently restores the prior valid date. Final generation was not clicked; valid dates restored. Luna max owns the bounded validation/accessibility correction.
- PASS actual service-record persistence: in desktop admin editor for QA customer163, first planned visit2026-09-21, saved only `QA 검수용 입력입니다. 실제 서비스 제공 기록이 아닙니다.` in special notes through preview and 수정 확인. Reloaded page and reopened that visit; exact note remains. No health facts, payment confirmation or signature were entered and no external link was sent.
- FAIL ADMIN-RECORD-COPY: same unsubmitted visit says `이미 제출된 회차입니다. 최종 기록을 확인해 주세요.` despite editable status and no signature. Traced to shared confirmation copy keyed on editing rather than submitted state. Luna max owns a copy-only admin-mode correction.
- Full QA remains incomplete. These checks use the dev DB and local authenticated QA servers; no production code deployment or dev/main merge is implied.

### Additional desktop interaction coverage

- PASS QA-branch management: empty required branch name shows `지점명을 입력해 주세요.`; restored the existing name and saved office address `QA 전용 지점 주소 수정 확인`. Reload/search confirms persisted address. Slug, manager, activity, contacts and other branches unchanged.
- PASS bounded empty states: consultation read/unread filtering and QA search return explicit no-results; notification panel says no new notifications and closes correctly.
- PASS read-only message-template tools: cost-template rendered preview, variable list, version1 history and version preview; modal closes and Escape closes history with focus returned to its trigger. No shared template was edited/restored/reset.
- Settings: account identifies the selected QA branch; email/browser notifications explicitly disabled, dark/system themes explicitly 준비 중, two-factor explicitly 준비 중. These are unavailable features, not executed capabilities. Password-reset link was observed but no credential change attempted.
- NOT EXECUTED: owner notification test explicitly targets all subscribed devices with an immediate broadcast. It cannot be isolated to the controlled QA recipients, so no broadcast was triggered. This remains an uncovered live-dispatch case, not PASS.
- PASS draft-only website ribbon preview: message/link text/URL update preview; reload restores empty values and inactive state. No save/publication performed; global persistence remains untested.
- PASS populated employee linkage: QA employee133 담당 고객 shows QA customer163 with Sept21–29 dates and primary assignment. This reflects assignment persisted before failed contract issuance, not a successfully issued contract.
- PASS populated desktop service schedule: Sept21 calendar cell shows one service-start event; selecting it opens QA customer detail with correct address, assignee, five-day dates and prices. Customer status remains 예약 전. Daily completion, schedule modification and issued-document state are not implied.
- PASS cross-screen record state: desktop schedule customer detail shows submitted0/5, 임시저장1, 작성 중, exact saved QA note and 서명 전. The admin note save does not falsely finalize the visit.
- ADMIN-RECORD-COPY corrected by Luna `e45e926e9`, integrated `b68d1b056`. Main type-check and frontend UI gate pass; live reload shows `관리자 수정 내용을 확인해 주세요.` and no already-submitted claim. Existing participant copy/state unchanged. Production build/shared review remain in next combined gate.
- FAIL MOBILE-EMPLOYEE-DATE-DISPLAY: at390x844 담당 고객 showed full ISO timestamp range wrapped across lines. Existing 근무 내역 and desktop use the shared date formatter; bounded correction delegated to Luna max.
- PASS actual mobile employee edit: added 연수구 alongside 남동구 for QA employee133, saved, reloaded, searched and reopened detail. Both regions persist; requested name/phone, best grade and available state remain. No non-QA employee changed.
- Mobile date correction integrated as `59441d2ff`. Full mobile suite263/1794tests PASS; type-check PASS. Main UI architecture gate initially failed because existing contract-page debt identities moved with added lines (same kinds/counts); worker tasked to re-anchor only verified relocations. Do not treat this pending gate as PASS.

### Integrated mobile and record UI recheck

- PASS live mobile date guard after reload: reversed end date260920, incomplete end2609, impossible payment260230, and empty payment each preserve entered text, show the relevant Korean reason and disable generation. Valid Sept21/Sept29/paymentSept18 clears the error and enables generation. No final generation was clicked. Three date fields expose associated accessible names;390x844 error text and action layout are readable.
- Mobile date UI baseline correction integrated as `426a98c0e`:22 contract-page existing findings re-anchored, same kinds/counts, no new debt and no unrelated baseline deletion. Main complete UI architecture gate now exit0. The earlier worker PASS claim was corrected after reproducing its omitted failed output.
- MOBILE-EMPLOYEE-DATE-DISPLAY corrected by Luna `c4d38337a`, integrated `155812c99`; reload and390x844 screenshot show `2026.09.21 ~ 2026.09.29` on one line. Existing employee focused suites2/8tests passed; main live verification passed.
- Frontend production build PASS. Initial mobile build failed because its process lacked existing NEXT_PUBLIC_API_BASE_URL; rerun using the existing frontend env file for the build process only passed. No env values/files were changed. Both authenticated loopback QA servers restarted with approved launchers after builds.
- Independent Sol FINAL review requested for exact `3330b1f7e..426a98c0e`; outcome pending. Backend workflow-recipient correction remains a separate implementation in progress. No merge/deploy or contract-delivery success claimed.
- Independent Sol FINAL decision: SHIP, high confidence, exact cumulative `3330b1f7e..426a98c0e`; no blocking findings. Low note: pure admin-copy branch has live verification but no committed text-only regression test. No security/schema/env/dependency behavior change. This review covers the mobile/record UI bundle only, not pending backend workflow work or production acceptance.


### QA schedule postponement and restoration — 2026-09-18

- QA client 163 only: the client schedule-change action postponed five sessions from 09/21, 09/22, 09/23, 09/28, 09/29 to 09/22, 09/23, 09/28, 09/29, 09/30. Upcoming message list remained empty.
- Selecting an earlier date in that action is intentionally disallowed by both UI and backend postponement rules; the initial suspicion of a logic defect was corrected. Desktop/mobile copy now explicitly explains postponement-only behavior (integrated ced005a56).
- Restored each session through the existing admin service-record date-edit UI. After reload, all five dates are again 09/21, 09/22, 09/23, 09/28, 09/29; customer detail shows 2026.09.21–2026.09.29. No signature or health information was entered.
- Schedule copy worker checks: desktop 2 tests, mobile 3 tests, both typechecks/scoped lint/UI gates passed. Parent browser rendering and integrated validation remain pending.

- Parent schedule-copy integration: desktop2/2 and mobile3/3 tests pass; desktop modal and mobile390x844 screenshot show the new guidance without clipping. Closed both without further changes. QA note remains intact, submitted0/5 and temporary draft1 after full restoration.
- New finding: desktop revision history exposes raw SERVICE_RECORD_REVISION_WAITING_FOR_COMPLETION. A scoped Luna correction is in progress; backend state/retry semantics remain unchanged.
- Backend workflow mapping integrated as25e82f114 (worker fe1b611d9): parent6suites/93tests, type-check and build PASS. Independent final review and actual provider retry remain pending; no new contract send yet.

- Fresh read-only provider config for the exact QA template returned HTTP200 and passed the newly built parser: writer seq1/group1, customer participant seq2/group3, institution participant seq3/group4, completion seq4/group2. No recipient contact/config payload was logged. This verifies live config compatibility, not dispatch success.
- After restoring all session dates, reloaded message history and filtered upcoming:0, no scheduled dispatch.

### Contract retry and revision-copy follow-up — 2026-09-18

- Backend workflow independent Sol FINAL: SHIP, medium confidence, exact worker fe1b611d9; no blocking findings. Only production caller supplies validated workflow, though optional legacy fallback is a future misuse risk. Restarted reviewed local backend with SCHEDULERS_ENABLED=false; dev database fingerprint matches previous QA.
- Clicked QA163 contract generation once at04:59 KST, same controlled recipients and QA template, Sept21–29/paymentSept18. Request was blocked with existing-operation conflict before any headless provider-send log. Browser then fell through legacy generateDocument, returned HTTP410 and misleadingly displayed `요청한 정보의 이용 기간이 끝났어요.` No repeated generation was clicked. Exact intent state/fingerprint and correct recovery path under investigation; do not claim external delivery.
- Workflow-failure UI implementation c3ccf739 remains unintegrated pending correction: unchanged retries should reuse persisted ID, but edits between retries must still update that customer before dispatch. Independent review and Luna follow-up in progress.
- Revision reason copy integrated3fb85d0b2 (worker5780ce18c); parent33focused tests passed. Live history replaces raw waiting code with Korean explanation, preserves `기록 완료 대기`, draft1/submitted0/5 and QA note. Unknown codes intentionally omitted; status/retry behavior unchanged.

### Reviewed retry corrections and second provider attempt

- Integrated workflow-failure feedback248da7570 plus retry-payload correction750413ede (workersc3ccf739/50aae152d). Independent Sol FINAL initially required an edited-retry fix; corrected cumulative UI received SHIP/high. Customer ID reuse and payload snapshot comparison now remain separate, preserving edited dates/assignments before retry without duplicate creation.
- Integrated narrow claim-conflict classificationc077318e0 (worker11c415cec), independent Sol FINAL SHIP/high. Claim-time ConflictException returns stable manual-review outcome and never falls through the obsolete HTTP410 generation endpoint. Identity/fingerprint fences remain intact.
- Parent integrated gates: frontend4suites/51tests, mobile4suites/43tests, backend6suites/95tests PASS; all three typechecks and production builds PASS; complete UI architecture gate exit0. Both loopback QA launchers and scheduler-disabled backend restarted after builds. No schema/env/auth/dependency changes.
- A separate Sol PLAN approved one existing API force:true resend only after sequential preconditions. At05:14:50 KST: originalintent remains reconciled_not_delivered; all client163 local mirrors0/jobs0; complete provider lists01/03/04 scanned41/233/276 entries with0QA-template matches; exact QA area/template, live assignment142/employee133, approved recipient phones and Sept21–29/paymentSept18 verified. Frozen body hash recorded locally; one-shot marker prevents accidental command rerun.
- Executed the supported force-initial API operation exactly once. HTTP201 payload ok:false, reasonremote_unconfirmed, fallbackHintmanual_check, failedStepcreating, newintentdd77ed7b-8595-4547-bfab-9be9d86e0075. Headless logs reached top-level 전송, then no confirmation popup/terminal SDK callback; mapping correction alone did not resolve the failure. No further retry.
- DB verification: old initial intent still reconciled_not_delivered/attempt1; new force-initial intent uncertain/attempt1/providerDocumentIdnull; local mirrors0. These are not evidence of successful delivery. Provider-popup investigation continues.

### Additional header validation finding

- Admin service-record header: with all other draft values populated, invalid date260230 and negative weight-1 both leave 수정 확인 enabled without a field error. Server source currently validates only key/type/length, so a bounded UI/server correction is in progress.
- The single invalid-date save attempt hit an existing version-conflict safeguard after the contract flow updated the customer; invalid persistence was not observed. The stale-edit UI preserved inputs and offered recovery. Cancelled the unconfirmed revision through the normal confirmation dialog, reopened basic information and verified original empty values. No test health data or signature was finalized.

### Continued verification and diagnostic boundary

- PR708 at exact head e2dd2542d: required frontend, mobile, backend, shared-contract, auth enforce/observe and stubbed full-flow/call-inbox CI checks pass. Deployment and advisory browser jobs were skipped; this does not establish production acceptance.
- Reloaded QA163 customer detail: controlled contacts, address, assignment and Sept21–29 dates remain consistent. Contract tab still explicitly has no contract information; no success status is claimed.
- Read-only native QA-template inspection did not save or send a document; the inspection tab was closed. It did not identify the failed headless click target.
- Source tracing confirms diagnostics cannot identify which duplicate send button was selected, generic confirmation clicks are labelled as company-stamp confirmations without dialog identification, and SDK action callbacks are stored without a diagnostic projection. These are evidence gaps, not a confirmed provider-failure cause. A bounded offline observability plan is under review; no further provider retry occurred.

### Admin header correction and live input recheck

- Integrated Luna c7f436034 as b04d7ff19: strict YYMMDD calendar and positive finite decimal validation, Korean inline errors, explicit input labels and error associations, admin handler guard, and server validation limited to changed nonempty fields. No schema, auth, dependency, env or vendor changes.
- Worker frontend42/backend44/mobile6 focused tests, relevant typechecks, frontend/backend builds and UI architecture gate pass. Parent integrated frontend42/backend44 focused tests and frontend typecheck pass. Independent FINAL review remains pending at this point. Package source files were ignored by the scoped frontend ESLint invocation; do not claim those files received standalone ESLint coverage.
- PASS live: invalid baby date260230 with weight-1 preserves both values, displays both Korean errors and disables 수정 확인. Restoring260917/3.2 clears errors and enables the action. Incomplete maternal date9001 and exponent weight1e3 again preserve input and disable save with explicit reasons.
- PASS visual at390x844: both inline errors and disabled action fit without horizontal clipping. Input names now appear in the accessibility tree. Cleared the viewport override and reloaded to discard all unsaved synthetic header values; no health information or signature was finalized.
- New copy finding: an explicitly canceled service-record-link job is excluded from upcoming jobs but the customer record tab still promises automatic dispatch. Source confirms existing canceled status is available while the normal record view hides its badge. A minimal canceled-specific hint correction is assigned to Luna; dispatch behavior remains unchanged.
- Independent header review requires correction: UI validation currently includes untouched legacy header values, potentially blocking a name-only edit despite backend changed-field behavior. Backend future-date test also depends on the current day and must use a fixed clock. Both corrections were returned to the same Luna worker before acceptance; b04d7ff19 is not FINAL-approved.
- Corrected header validation integrated96c741f65 (workerb41ac2006). Only changed header fields contribute errors; regression preserves untouched legacy ISO date/Infinity weight during a name-only patch. Removed wall-clock-relative test data in favor of deterministic leap/calendar cases. Independent cumulative FINAL e2dd2542d..96c741f65 is SHIP/high, both blockers resolved.
- Canceled-link hint integrated933e9fae0 (workerf063f2f2a). Main reviewed copy-only diff and live customer163 now explicitly says `자동 발송 예약이 취소되었습니다. 다시 보내려면 수동 전송하세요.` No manual send was clicked.
- Latest parent integration: frontend2suites/77tests, backend1suite/43tests, frontend typecheck, frontend/mobile production builds and full UI architecture gate pass. Restarted both approved loopback QA launchers after builds. Headless diagnostics remain a separate in-progress unit, with no provider retry.
- Backend build also passes; restarted the reviewed backend with schedulers disabled. Parent then opened every remaining session2–5: dates09/22,09/23,09/28,09/29 match the restored schedule, empty health/payment/signature states are explicit, and unchanged confirmation returns to the overview. Session4 maternal, infant and service edit links open their respective sections and return to review without entering values. This is navigation/empty-state coverage, not populated health-record submission or signature coverage.
- After navigation, customer overview still shows submitted0/5, draft1, revision6 and the original QA note. No additional record was finalized.
- PASS draft-only customer edit: employee133 is excluded from secondary search while selected as primary; after clearing primary it becomes selectable as secondary, and is then excluded from primary search. Cancel discarded this temporary swap; detail still shows employee133 primary and no secondary.
- PASS draft-only pricing UI: 2026 A가1형10days recalculates total1,464,000/grant1,165,000/copay299,000 and end10/07. Switching to2025 clears duration/prices until reselecting5days, then gives712,000/642,000/70,000. Self-pay5days shows815,000 and hides subsidy fields. Cancel restores the saved 2026 five-day732,000/659,000/73,000 and09/21–09/29 state. These checks establish app recalculation/display, not independent official rate accuracy or persistence of the alternative pricing.
- Period mismatch was entered only in the discarded draft; no immediate inline warning appeared. Save-time mismatch handling remains unverified, so it is not marked PASS.
- Follow-up PASS for mismatch cancellation: after verifying the existing pre-persistence guard, reopened the original customer edit and changed only end date to09/22. Saving opened `서비스 기간 확인` before persistence; cancellation retained the typed09/22 draft. The override confirmation was not accepted. Initial duplicate-warning suspicion was disproved: the shell description is sr-only and a screenshot confirms one visible warning; no code change was made. Cancelled the entire draft and confirmed original09/21–09/29 schedule, primary employee and prices remain. Successful mismatch override persistence is not claimed.
- PASS mobile contract pre-send navigation: searched and selected QA customer163 and the QA-only contract type; customer birthday/address/start date and primary employee133 carried through. Voucher step shows2026 A가1형5days and732,000/659,000/73,000; final review shows09/21–09/29 and payment09/18. Back navigation preserves voucher values. Closed the wizard without clicking generation and returned to the contract list showing0 documents. No additional provider request or customer change occurred.
- Updated the detailed case inventory to remove stale claims that the dev QA customer had not been created or every gap case was unexecuted. Partial evidence and remaining role/device/failure/delivery branches are explicitly separated; no aggregate QA completion rate is claimed.
- Read-only recheck at2026-09-18 06:17KST, over one hour after the second ambiguous request: all provider lists01/03/04 were paged completely with stable totals41/233/276 and unique document IDs within each list; exact QA-template matches remain0. At06:18KST local client163 mirrors0/jobs0; latest intentdd77ed7b-8595-4547-bfab-9be9d86e0075 remainsuncertain/attempt1/providerDocumentIdnull. No new contract send occurred. Supported evidence-based reconciliation is under independent plan review.
- Independent Sol PLAN approved reconciliation only, with sequential fresh preflight and post-verification. Repeated complete provider absence scan at06:20KST with unchanged totals and0QA matches, then checked exact API/DB intent and zero local mirrors/jobs. At06:21KST posted the supported owner reconciliation once fordd77ed7b-8595-4547-bfab-9be9d86e0075, outcome`not_delivered`. API and DB now agree on`reconciled_not_delivered`, attempt1, null provider ID; reconciliation actor/time/exact aggregate evidence reason are recorded, mirrors0/jobs0. This supersedes the previous uncertain status. No retry, provider submission or job creation occurred.
- Integrated offline headless diagnostics as`e0388b392` (Luna`1c95d4e6e`): fixed action/category/count/index and SDK projections replace raw callback/DOM text logging; category is inspected before click, dialog presence is observed after click or explicitly unknown. Main review required preservation of undefined error-callback clearing and removal of fabricated dialog absence. Parent4focused suites/31tests, backend typecheck/build and scoped8-file ESLint pass. Independent FINAL is pending; the running backend has not yet loaded this change. This is observability work, not a confirmed fix for missing contract issuance. Worker network dependency audit was not run; `pnpm audit --offline` is unsupported.
- Independent Sol FINAL for`275ce4f35..e0388b392`: FIX_REQUIRED/high. Ambiguous popup/top-level clicks do not emit selected candidate evidence, and SDK diagnostic page evaluation has no bound when its promise never resolves. Returned both findings to the same Luna max worker with regressions required. Runtime remains on the previously reviewed code; no diagnostic reproduction or provider retry is authorized by this review.

### Remaining mobile routes — visual and navigation coverage

- `/employees/schedule` renders the correct QA customer163 start09/21 and employee133 in its next30days list. The page has no date/view controls and its rows are intentionally noninteractive; earlier inventory suggestions to exercise those controls do not describe the implemented page. FAIL visual at390x844: the full date is clipped inside a34px badge. Assigned a compact-date display correction to Luna max; full subtitle date must remain.
- `/messages/automation` read-only inspection: five rules, recovery-marker toggle disabled, current provided-record rule and existing active states rendered. Opened the seven-day service-start rule and verified event/start-minus7days/09:00KST/customer/template values; returned to the list without editing, toggling, deleting or saving. No scheduler or dispatch action executed.
- `/dashboard/analytics` displays basic counters but no chart/date/filter controls. Detailed charts are unavailable, not PASS; implementation-planning copy `상세 차트는 다음 iteration에서 연결됩니다.` is assigned a user-facing placeholder correction.
- `/dashboard` start filter opens QA163 detail with correct identity, assignee, dates and prices; close returns correctly. Action-needed and ending-soon filters each show their explicit empty message. Restored All and cleared the390x844 viewport override.
- FAIL count consistency: home/analytics card says seven-day starts0 while home upcoming filter/row shows1 forQA163. Source tracing confirms mobile analytics derives across all paginated clients but excludes`pre_booking`; home list uses a separate predicate that includes it and only loads the first50clients. This is a predicate/coverage mismatch, not evidence of a backend database count failure. A bounded shared-predicate plan is under independent review; do not hide the existing upcoming row as an unreviewed workaround.

### 2026-09-18 — controlled contract creation and PDF mismatch

- Corrected safe diagnostics at `6814082a91b78b1126a7bf6fab76bb8e7a6fb057` received independent FINAL SHIP. Parent checks: 4 suites / 33 tests, backend typecheck, build and scoped lint passed.
- Exactly one reviewed diagnostic attempt created provider document `212cb0fc439d47aca49eb0e97886d788`, local mirror 12638, QA template `3868b1fc23aa4013a10e0415636da609`. Dispatch intent `dd77ed7b-8595-4547-bfab-9be9d86e0075` is accepted, attemptCount 2. Independent provider GET confirmed document/template and recipient matching QA client 163, status 060 (signature pending). No additional retry, cancellation or signature was performed.
- Browser PDF preview and download event succeeded. All 9 rendered pages were visually inspected. Supported download endpoint returned a 754107-byte PDF. Provider acceptance does not establish actual handset delivery; user receipt confirmation remains pending.
- **FAIL: PDF page 3 customer phone differs from client 163.** Recipient routing uses the correct customer number, but `EformsignService.generateDocumentOptions` maps `이용자 연락처` to `issuerPhone || customerContact`, causing the logged-in issuer number to appear in the customer field. Name, birth date, QA address, dates, prices and caregiver information matched the controlled request. The existing document must remain unsigned pending correction. Backend mapping fix and independent review are pending; no full contract PASS is claimed.
- Mobile presentation fixes at `aa07f6196edd4ddbb37217076c61d6ca9fe3b011`: schedule badge displays day 21 with full date retained; analytics placeholder now says detailed charts are being prepared. Parent mobile build and UI architecture gate passed; live visual checks passed.
- Upcoming-count fix at `89524f7fde8462199af04e2b30fea0e5aebb32a3`: parent 3 suites / 15 tests and mobile build passed. After local server restart, analytics and home both show one customer starting within 7 days; the selected upcoming filter shows the single expected QA customer. Contract-incomplete remains 0 for pre-booking as intended. Independent FINAL review is pending. Home first-50 versus analytics all-pages scope remains a known limitation.
- Upcoming-count independent FINAL review returned SHIP/HIGH for exact integration SHA `89524f7fde8462199af04e2b30fea0e5aebb32a3`; parent live verification above is also complete.
- Post-download desktop contract detail: generic status is signature pending, customer display repeats the same wrong document phone (same source-field defect); caregiver name/phone and service dates/day count/prices match QA fixtures. Stage dialog correctly lists creation, provider-recorded send, and awaiting user opening. These UI records do not prove handset receipt.

### 2026-09-18 — mobile route continuation

- `/contracts` at 390×844: all and signature-pending filters show the one created QA document; all three detail tabs, stage list, PDF preview, preview back and detail close work. Basic info uses the correct client phone, unlike desktop document fields/PDF (known mapping defect). Dates, five days, caregiver and amounts match. Notification tab shows prior controlled customer greeting and caregiver service-record-link send logs; it is not proof of receipt of this contract notification.
- Mobile PDF header download was clicked once. The browser download event timed out after 3 seconds; no toast or console error was observed. Source uses validated PDF fetch and a same-tab blob download anchor. A blank browser tab was observed but its relationship to the download is unproven. Mark actual mobile PDF download **unverified**, not PASS or confirmed product failure. No browser download-history restriction was bypassed.
- `/messages/templates` and `/messages/system-templates/GREETING` at 390×844: nine default templates, zero branch templates, readable greeting content, explicit desktop-only edit/version explanation, detail close/back and branch-empty filter checked. No template writes or sends. Other system-template contents and new-template writes remain untested.
- `/prices` at 390×844: 2026 list21, A가1형 detail5/10/15-day values rendered; 5-day732000=659000+73000 matched QA contract. D형0 empty state, 2025 year switch retaining filter, and all-filter reset restoring21 rows checked. No price update or external tariff-source accuracy claim.

- `/notifications` redirects to `/notification`; at390px both app/email channels are disabled with explicit reasons. The test-send control addresses all subscribed devices and was not executed.
- Desktop `/service-record-admin/163` directly renders the five QA service dates; first-date stored draft contains explicit QA-only note, no medical inputs/signature, and back returns to the list. No confirm, signing or persistence change performed.

- Mobile receipt PNG download was clicked once with a 30-second event window: no download event, no failure toast, no relevant console error. Previously captured network events contained no download response, so this does not prove transport success/failure. Receipt download remains unverified alongside mobile PDF download.
- One instrumented mobile PDF download recheck observed HTTP200 `application/pdf` and no network loading failures, but no browser download event within15 seconds. Transport succeeds; saved-file completion remains unverified. Network instrumentation and390px viewport override were cleared afterwards.
- Customer-phone fix integrated at `8bd495ce7fa4558dfb6d549864a77e098e78d7bd`; parent focused43tests and backend build passed. Independent FINAL pending. Worker backend/frontend typechecks/builds/lint passed with existing warnings. Offline dependency audit unsupported by installed pnpm; no dependency changes.
- Correcting the existing unsigned QA document through the product requires unrecoverable cancellation/purge, per explicit UI text. No cancellation performed. This step needs action-time confirmation before one corrected issuance; existing evidence/PDF preserved.

- Customer-phone correction final cumulative SHA `5060121597d862a956e1273474ecb6d7ec12615d` received independent FINAL SHIP/HIGH; misleading frontend comment was clarified. Provider fresh read-only check still confirms exact QA document/template, status060 and correct customer recipient. Desktop irreversible-delete confirmation is open; user action-time answer pending, no delete performed.
- Reviewed customer-phone backend is now running locally (PID86885), same dev DB fingerprint13a998ed6278 and SCHEDULERS_ENABLED=false. No new contract request performed.
- `/files` and `/files/upload` at390px: empty list, upload entry, allowed types/25MB/single-file limit, categories, disabled empty submit and cancel-to-list checked. Owner upload explicitly publishes to all branches, so actual upload was not included in isolated-QA write coverage.
- Mobile `/stats` reachable from actual all-menu navigation at390px; four categories use dashes while unavailable. `/stats/inquiries` explicitly shows connection-required state, retry control and back navigation, rather than reporting zero. A single retry preserved the explicit unavailable state; no successful metrics/source reconciliation claim.
- Root-agent online `pnpm audit --prod --json` completed successfully: info/low/moderate/high/critical all0, advisoryCount0, no audit error. This resolves the implementation unit's unavailable offline audit; dependency files remain unchanged.
- Mobile `/consultations` at390px: QA branch returns0 rows and explicit empty state with search/status controls. Populated-detail/mark-confirmed flows remain untested due no isolated consultation fixture.
- Mobile `/messages/settings`: seven settings render at390px; duplicate-send confirmation detail shows same recipient/body and72-hour rule, back restores list. No switch was changed. Some automated-send descriptions expose internal technical terms (e.g. atomic job claim); copy improvement remains an observation.
- Additional dashboard defect confirmed by read-only source trace: only first50 client records contribute to actionable/upcoming/ending rows, despite all-page analytics. Independent PLANv2 approved backward-compatible all-page hook integration, stable-ID dedup and atomic pending/error handling; Luna/max implementation ongoing in isolated unit. No51 live clients created.
- Public mobile negative paths at390px: `/receipt/qa-invalid-20260918` and `/service-record/qa-invalid-20260918` use deliberately invalid QA-only tokens. Both finish loading with Korean invalid/unavailable-link guidance and contact instructions, with no sensitive record exposed. Valid receipt identity/download and valid service-record completion/signature are separate unverified cases.
- Mobile owner `/system-admin?section=branches` at390px: QA branch search returns1, detail shows all fields without persistent horizontal clipping after transition. Invalid email `qa-invalid` yields Korean validation error while preserving input. Restoring original empty email and saving clears error; reload retains empty email and original QA branch name/slug/address/active state. Only approved QA branch touched; no role/owner/activation changes.
- PR708 at `96ad87142949559dba720842c36ce0256bdefe34`: frontend/backend/mobile/shared checks, backend flow/call-inbox and both auth E2E modes succeeded. Deployment jobs and advisory real-backend Playwright were skipped; no deployment or complete real-browser coverage is inferred.
- Additional mobile detail semantic bug: label `계약서 종류` displays `document_number` (QA2026_1), unlike desktop `문서번호`. A label-only correction is under review; document values are unchanged.
- Cancellation/reissue preflight discovered a concrete dispatch-identity block without mutating data: current initial intent96b12943 is reconciled_not_delivered with a different frozen-payload fingerprint, while force-initial intentdd77 is accepted with the current fingerprint and doc212. Both have null localDocumentId, assignment142 and exact QA template. Deleting the mirror alone would make normal creation conflict and forced creation return the previously accepted provider ID. `progressId` is telemetry only, not a new request key. Cancellation remains unexecuted; an independent lifecycle PLAN is being assessed. No intent reset, payload manipulation or duplicate request was used.
- Dashboard pagination fix integrated at639e7dc5464d84a41c56c95a37bbe33d961dccd9; worker PLANv2 checks passed and parent regression/independent FINAL are in progress. The existing50-page upper bound remains explicit.
- Pagination fix639e7dc independent FINAL SHIP/HIGH and parent5suites26tests PASS. The safety cap is50 backend pages /2500 clients; concurrent offset-page shifts can still omit records, although stable-ID dedup prevents duplicates. No claim beyond this bound.
- Existing document delete confirmation was dismissed without deletion while the cancellation/reissue lifecycle is reviewed. The user's irreversible-action question remains pending; the document remains unsigned and preserved.

- Pagination parent mobile build passed; after approved QA launcher restart, authenticated 390px dashboard displays the expected one upcoming QA customer and matching count.
- Mobile contract number label integrated at5f0979345afa15566370cd28c9d5fad13fc84fc3 and received independent FINAL SHIP. Authenticated live AX and390px visual check show `문서번호` with unchanged QA2026_1. The focused Playwright case failed before its assertion because its login cookie was lost and the page redirected to login; automated coverage is not claimed.
- Cancellation/reissue PREPARATION-only plan approved by independent Sol: isolated Luna/max backend code and mocked tests plus a non-executable CHECK-migration proposal. No executable migration, database mutation, provider action or integration merge is authorized by this phase. Current database action CHECK excludes cancel; actual compatibility and transaction races remain to be verified after concrete migration approval.
- NEW FAIL, admin service-record163/session1: meal count -1 advances to confirmation and displays `식사 -1회`; breastfeed count1.5 and formula-per-feed -10 advance and display `1.5회` / `회당 -10ml`. No final confirmation/save/signature clicked. All three values were cleared back to empty in the editor and confirmed empty. Input and server validation tracing is in progress; this observation alone does not prove invalid server persistence.

- Numeric gap narrowed by source trace: server `validateServiceRecordAnswers` already rejects negative/off-step/non-safe-integer counts before admin draft persistence; existing tests cover negative/fractional meal counts. Shared wizard admin-mode navigation bypasses completeness gating and lacks immediate semantic errors. UI fix is under independent plan review; invalid server persistence is not claimed.
- QA163/session1 other-service memo saved as clearly synthetic QA text with Korean, newline, `<>&` and quotes. First save encountered explicit revision-conflict guidance; latest-record recovery returned to overview with original data. Re-entered the same harmless QA memo once against fresh state, saved successfully, reloaded and reopened session1: memo persisted, all health answers remain empty and no signature exists. The initial conflict cause was not independently established; recovery/persistence are verified.

- Cross-surface persistence PASS: desktop customer163 provided-record panel shows the saved QA memo (newline and special characters intact), submitted0/5, draft1, unsigned, revision7. Mobile customer163 provided-record detail independently shows the same memo, draft state and empty health/payment/signature values. No outbound send or finalized service record resulted from this memo edit.
- Mobile provided-record edit link currently targets the configured local desktop origin127.0.0.1:3000, whereas this QA desktop runs3100. Direct3100 admin-record QA is verified; the configured cross-app link itself is not counted as a successful end-to-end navigation in this local environment.

- Desktop dashboard at original desktop width:0active/1upcoming/0contract-needed, explicit no contracts ending next business day. Date filters/drill-down cards suggested in old inventory are not present on this page. Verified actual customer-registration and contract-generation quick links open their empty wizard and Cancel removes the query flag and returns to the proper list, without creation/send.
- Mobile system-template read coverage now includes all9 default templates: priorGREETING plus fee, reservation-confirmed, monitoring, service-guide, provided-record-link, service-end, reminder and info-request. Load-more7→9 and per-detail close-to-list passed; bodies and required-variable metadata render. Long INFO detail at390px scrolls to its bottom action. No template write/send or external template-claim accuracy validation.
- SERVICE_END_NOTICE template-to-composer retains selection/body; selectingQA163 replaces name but shows explicit `고객이 계약서 서명을 완료해야 발송할 수 있습니다.` with Send disabled. No SMS sent; recipient was removed. Valid receipt-link QA remains blocked by this unsigned fixture, not marked PASS.
- NEW FAIL: same autocomplete suggestion labels QA163 `계약완료` despite unsigned060. Read-only trace finds API hasSigned derived from eDoc existence; this boolean feeds several UI completion/waiting labels. Actual receipt send guard is correct. Status semantics fix under review, no new provider call.
- Visual observation: INFO template bottom send button at390px appears too narrow for its Korean label; screenshot shows text extending toward the white surrounding card. Needs component sizing review before declaring visual PASS for that control.

- Confirmed mobile template CTA horizontal overflow numerically: button width123.648px/clientWidth124, scrollWidth140, nowrap,24px horizontal padding. Shared footer sizing correction under independent plan review.
- Mobile new-template route explicitly explains desktop-only creation and links back; no empty nonfunctional form. Desktop QA branch new-template creation succeeded for `QA 전용 20260918 문자 입력 검수`, one name variable, multiline QA-only body with special characters. UI preview substitutes [이름], reports130bytes/LMS, and saved template appears in the branch-template list. No message sent or system-default template changed.

- Custom QA template update PASS: changed name to `QA 전용 20260918 문자 수정 확인` and revised multiline body; saved state survived desktop reload/reselection. Mobile reload shows10total/9default/1branch and branch filter isolates the new template. No template deletion or send performed.

- Controlled custom-template send: from mobile detail selected `QA 전용 20260918 문자 수정 확인`, chose exactQA163/QA 고객 승인번호, verified substituted name and QA-only multiline body, clicked Send once. UI acknowledged `메시지 발송 요청이 접수되었습니다.` and cleared recipient. This is request acceptance only until final log/provider state is checked; no repeat send.

- Custom-template SMS app history now shows success at2026-09-18 08:06KST, exactQA163/QA 고객 승인번호 and exact substituted QA body including special characters. Aggregate6history=5success+1cancelled,0scheduled,0failed. New message provider-final delivery and handset receipt remain separate checks; no additional send/retry.

- NEW FAIL branch-template edit validation: changing the isolated QA template name to three spaces left Save enabled; clicking Save completed successfully and list label became only its date. Restored `QA 전용 20260918 문자 수정 확인` immediately and confirmed named row/save-disabled state. No send during invalid-name interval. API/DTO validation trace pending; blank-name creation and blank-body persistence not exercised.

- Numeric-validation correction integrated4166d4590869967c2b02a3b104fedce954354620, independent whole-implementation FINAL SHIP/HIGH. Parent tests: frontend44 +mobile20 pass. Authenticated admin163 at390px: meal-1 retains input and shows Korean min error with Next disabled; breastfeeding1.5/formulaml-10 show step/min errors and block Next;0/integer/36.7 clear errors; blank admin values remain allowed. All test values cleared, no save/signature, then reloaded. Numeric strings over500characters remain a minor UI/backend mismatch; backend safely rejects them.
- Sole mobile template CTA correction integrated through7fa2fe34c22d60d799a5ceaf64eb046996a03b4f, independent whole-implementation FINAL SHIP/HIGH. Parent authenticated INFO390px visual and DOM check: button clientWidth326/scrollWidth326, grid-column1/-1, complete Korean label and icon visible. Before fix124/140. Worker focused3Playwright cases (including actual button overflow), type/lint/build/UI gate passed. Dual-action long-label behavior was not changed.

- Custom-template SMS final-provider verification at2026-09-18 08:32KST: exact QA branch/client163 log73, created08:06:30KST, local sent/accepted. Read-only Aligo sms_list returned HTTP200/result_code1 and exactly one matching approved QA recipient with sms_state발송완료/send_date08:06:30. This establishes provider-reported delivery; handset receipt/read remains unconfirmed. No send/retry occurred during verification.

- Populated consultation QA now exercised on isolated dev branch: preflight found0notification recipients/0push subscriptions and both web-push/email notification flags disabled. Exactly one supported public intake POST created synthetic inquiry246db8e9-f998-48c5-a9c1-9cd6063695f8 at08:38KST with201/new, approved QA customer contact and explicit non-service QA copy. Mobile390px showed1total/1new; opening detail marked it read and changed counts to0new/1read. Both detail tabs displayed correct QA fields; newline/special characters remained literal/readable, no visual clipping. Read/unread filters and name/phone-fragment/address-fragment searches, including nonmatch empty state, passed. No contract/SMS/real customer record changed.

- Consultation continuation: reload retains1read/0unread. Desktop read filter/detail tabs show the same QA record, literal multiline note, read timestamp and new progress state. Public intake rejects invalid phone, nonexistent calendar date2026-02-30 and privacyAcceptedfalse with400; no extra successful records created.
- Whitespace-template correction integrated atd20279617; parent backend8suites34tests/frontend4tests passed. Live desktop QA template editor rejects saving a three-space name with a Korean field error and preserves the input; restoring name clears only that error. Whitespace/newline/tab-only body also rejected with body guidance. Restoring exact original multiline body clears errors and leaves Save disabled as unchanged. Existing named list row remains. Independent FINAL/backend runtime restart still pending.

- QA branch message settings: duplicate-send confirmation switch saved off, reloaded off, then restored on and save-completed controls returned enabled. Other six switches stayed on. No message was sent while the duplicate warning was disabled; local scheduler remained disabled. This verifies branch setting persistence/restoration, not scheduler execution.
- Independent signed-state FINAL found a stale eDocId override on mobile detail; correction integrated67609d922 preserving backend canonical hasSigned/documentStatus. Parent page-level regressions2/2pass for both stale-state conflict directions; fresh whole FINAL pending.
- Independent whitespace FINAL confirmed backend integrity/baseline bounds but found dedicated TemplateEditor create/edit routes lacked inline whitespace validation. Returned to Luna/max for shared-editor correction; template-list editor live check alone is not complete frontend coverage.

- Signed-state cumulative unit42ac5e1846648ef53b66eb0cbd9e1df888838af5 received independent whole-implementation FINAL SHIP/HIGH; integrationthrough67609d922. Parent backend224/frontend11/mobile20 plus page2 regressions passed, backend/mobile typechecks and backend build passed. Live backend restart/unsigned QA rendering check pending.
- Cancellation preparation remains unintegrated after independent FINAL FIX_REQUIRED: stale prepared-create after accepted cancel, optional backfill legacy bypass, and operator assertion without provider-state proof. Luna/max correction underway. Main read-only dev constraint inspection at08:48KST confirms exact eformsign_dispatch_intent_action_check permits create/finalize only; no migration/DBwrite/provider action performed.

- Reviewed backend now runningPID73486 on127.0.0.1:3001, same devDBfingerprint13a998ed6278 andSCHEDULERS_ENABLED=false; guarded runtime metadata and root health response verified. Initial old-process shutdown exceeded5seconds but oldPID subsequently exited and the sole listener is the new PID. No duplicate backend remains.
- Signed-state live PASS: mobile QA163 contract detail shows 서명 요청됨 and waiting signer고객, and message autocomplete no longer labels this unsigned client계약완료. Selecting this client forSERVICE_END_NOTICE still disablesSend with explicit customer-signature-required reason. Removed recipient without sending.
- Message-policy plain-copy fix integrateddc4fb1282, independentwholeFINALSHIP; backendbuildPASS and live mobile list/detail show 처리 중인 작업 확인 plus 발송 이력 instead of internal atomic-claim wording. Restored duplicate-warning setting remainsactive afterrestart/reload.
- NEW FAIL mobileclientcontracttab: card 발송날짜2026.09.18 but recentprogress 발송일2026.09.21. Source confirmed progress row uses serviceStartDate. Bounded correction under PLANreview; actual contract/status/provider data unchanged.

- Whitespace cumulative unitb6254d23b3b28491b56f6504b33cf3e01c9fbb82 receivedwholeFINALSHIP; integrated9b67dc35a. Parent shared-editor10testsPASS (initial test command used wrong path/ENOENT, corrected path passes). Dedicated create and edit routes both reject whitespace-onlyname/body with independent Korean errors, retain draft, and cancel back to the original single QA template. Create-route valid multiline correction clears errors and preview preserves characters; no new valid template saved during this regression. Parent frontendproductionbuild and fullUIgatePASS; approvedqa:fe restarted on3100.

- Contract sent-date correction integrated1b9db4aa5, wholeFINALSHIP; parent17tests/mobileproductionbuildPASS. Afterapprovedqa:mobile restart, actual QA163 contractcard 발송날짜 and progress 발송일 both show2026.09.18; waiting signer remainscustomer. No provider mutation.
- MOBILE-002 current local recheck: existing QA client contact now reports already registered and keeps Next disabled; approved QA employee contact (not an existing client) reports available and enables Next in an unsaved customer draft. Draft3steps pass, selfpay5days815000 and start09/21→end09/29 calculate, Back preserves inputs/price. Closed without Registration, so no third customer or new SMS created; successful final mobile creation persistence is not claimed.

- Mobile employees390px: QA133 appears for first-area남동구 and second-area연수구 search (latterreturns2). Detail3tabs show approved contact, both areas, QA163 primary assignment09/21–09/29 and no prior work. Standalone new route blocks duplicate employee contact, allows a controlled non-employee QA contact in draft, preserves grade and two areas/unavailable selection across steps. Clicking Register with no area returns Korean required-area guidance without creating a record; choosing areas clears error. Valid draft closed unsaved; list remains2employees. No outbound send.

- Mobile call inbox empty-state pass: review pending0 and history0 tabs render explicit empty guidance; history category/search controls remain accessible. Chat connection-only prompt explicitly prohibited data access/mutations/sends; assistant answered 연결 확인. New conversation cleared the QA exchange and restored the empty composer; no business action requested.
- Populated call UI fixture preparation: dev DB fingerprint and exact QA branch verified, no non-internal triggers on call_record/client_draft. Inserted one explicitly synthetic record1ee7e286-0cd3-4fe2-b56f-3598ec421f26 and pending draft294a7626-6aea-40ab-b3bf-9bc877c66456 transactionally, null phone/client association. This bypasses ingestion/AI by design and proves neither webhook nor extraction. Only history/detail/discard are in this fixture pass; customer confirmation is excluded because it invokes downstream customer automation.

- Synthetic call pass at390px: pending card opens proposal form and literal two-turn transcript; scroll reaches complete action buttons with no horizontal clipping. Discard moves draft to DISCARDED with reviewedAt00:24:29Z and nullclientId; pendingcount1→0, historyretains1with폐기 label, detailbecomesreadonly withsummary/transcript. Matchingtype/namefiltersreturn1; othercategoryreturns0. Original-audio link points to synthetic nonrecording ID and was intentionally not opened. No customer confirmation, ingestion, external AI or SMS operation performed.

- Additional mobile read/invalid-input QA at390px: /admin redirects to /admin/feedback; empty0/positive0/negative0 stats, filter changes and nonsense-search empty state render. Populated feedback detail remains untested. Search icon/input have missing accessible names; bounded shared mobile component fix under review. /contracts/creation redirects to /contracts/new; empty wizard closes to contracts without mutation. /reset-password withouttoken shows invalid-link reason and recoverybutton opens /forgot-password; blankemail shows Korean required guidance and malformedemail is blocked by browser validation. /verify-email withouttoken shows missing-link guidance, empty resenddisabled and malformedemail blocked. No valid auth email or credential operation performed.
- PR708 pushed through7d367247e; latest CI backend gate failed because generated agent-manifest.json is stale after schema metadata change. Fix pending; do not claim latest all-CI PASS. Other checks still progressing.

- Invalid feedback detail UUID displays explicit not-found/deleted guidance; back button returns to list. QA branch has0legacy chat_session rows, so populated legacy feedback detail remains untested and no synthetic user/session was fabricated. Supported feedback API scope requires a matching branch/user session and message.
- Manifest correction integrated3318cad26 from independently reviewed7cd61b92b: exactly createTemplate/updateTemplate sourceDigest changes,47capabilities and policy metadata unchanged. Parent agent:manifest:check PASS and push complete; new CI pending.
- Current call discard tenant trace: branch-scoped PENDING lookup precedes globally unique draft-id conditional write; no demonstrated cross-tenant access found. Subsequent write predicates omit redundant branchId, a defense-in-depth residual; this synthetic fixture test is not a role/enforce-mode production certification.

- Mobile legacy navigation checks: /messages/scheduled redirects to /messages/history; 예정 filter shows0and explicit empty message. /messages/sender-approval redirects to /messages/settings without a new request. QA template edit route shows read/send-only desktop-edit guidance, correct literal saved body, and its CTA opens composer with matching template/body and no recipient/senddisabled. Copy button copies the exact body including newline/special chars; existing clipboard was empty and cleared back after comparison. No extra SMS.
- Search label correction4499458d7: independentFINALSHIP,parent2testsPASS,liveAX now검색 열기/검색 닫기/검색어. Live close after typing also exposed pre-existing React parent-update-inside-state-updater warning; new bounded correction approved and assignedLuna/max. Labels alone do not close that runtime defect.

- Cumulative search correction8952ba287 receivedwholeFINALSHIP, integratedbcb585b0a. Parent3testsPASS. Live09:46–09:47KST open/type/close retains labels, clears value and returns original empty list; zero new consoleerrors since00:46:45.626Z, unlike original00:39:09render-update error.
- Manifest-fix CI at3318cad26 completed backendtype/lint/tests and authE2Eobserve/enforce successfully; local-stub full-flow/call-inbox andshared/securitypassed. Deployment skipped, not claimed. Subsequent search fix still requires its own CI.
- Mobile /settings redirects to /notification. /privacy and /terms static copy fits390px but promises unlinked desktop full documents absent from source. Login links point to these routes although middleware public allowlist excludes them; unauth navigation gap under review. Cookie-free localQA requests return307/select-branch dueQAautologin, so this is not observed production/login behavior. No legal adequacy or full-policy validation claimed.

- PC /clients/filtered: missingfilter shows explicit invalidfilter; supported incomplete-contracts andstarting-soon eachshowQA163,start2026.09.21,진행중. no-contract andending-soon showexplicit emptyresult. Close returns throughroot to dashboard. These are branch-specific observed UI results, not an exhaustive date-boundary dataset.
- Policy-route change PLAN independently approved: only mobile middleware publicallowlist /privacy,/terms plus focused tests, no layout/provider/copy edits. Explicit auth-boundary approval and canonical full-policy URL/content requested; no auth implementation started while pending.

- PC /all redirects to/dashboard atdesktopwidth. Independent /clients/new is a real form: duplicateQAclientphone blocksNext; approved QA non-client phone allowsStep2 with onlyname/phone, birthday/address empty; Back preservesname/phone and Close returnsclients withoutcreation. This differs fromdialog/mobile required indicators and is being traced before classifying intent; no thirdclient/noSMS.
- Search changeCI at660a7c27f passed mobileunit andtype/lint/test/build,shared andsecurity; advisory real-backendPlaywrightskipped, Vercelignoredbuild/canceled. Combined with preceding3318cad26 backend/authE2Esuccess, normal reviewed fixes have relevantCIproof; no deployment.

- Contract cancellation/reissue cumulative PREPARATION at74c4a0491d98caf7e55a8dd99a927cff06b9240c receivedwhole independentFINALSHIP/HIGH after exact provider-identity and evidence-wording corrections. This is preparation-ready only, remains outsideintegration. Focused8suites145pass29skip; precedingfull366suites5307pass44skip. No executablemigration/generatedSQL/schema/workflow/provider/DB changes. ManualCHECKexception for verifieddevtarget only requested with backup/recovery and isolatedconcurrency verification beforeapply; awaitinganswer. Production/merge/deploymentexcluded. Existingunsigneddocpreserved.
- Mobile register390px: empty submission shows separateemail/name/password/confirmationguidance; malformedemail blocked; whitespace-onlyname rejected with approvedQAemail present. No password entered/accountcreated/email sent. Clearedinputs; loginlink returnsdashboard throughcurrentauthenticated/QAautologinflow, so manualunauthlogin remainsuntested.
- Current integrationClientFormDialog confirmedfourrequiredmarkers, correcting earlier scoutreadingofdev. StandalonePC requiresname/phoneonly, mobile requiresbirthdaybutnotaddress, backendbirthday/addressoptional. Product-requiredfieldrule is not defined consistently; no newrequiredPII rule imposed.
- Dashboard metric discrepancy explained by currentcriteria: QA163 DBserviceStatuspre_booking andexistingpendingdoc verifiedreadonly. Mobile incomplete-contract count excludespre_booking; PC incomplete-contract filter includesnext7dayexistingunsigneddocuments. Thus0vs1 followsdifferentcriteria, notnewhasSignedprojectionregression. Cross-surface label/criteria alignment remains a productdecision, notdeclaredfullparityPASS.

- PC /settings/general and/settings/voucher-price bothredirect/settings accounttab. PC /messages/system-templates redirectsbranch/templates; /messages/system-templates/GREETING redirectsowner/system-admin templateGREETING andselectsit. Readonlycurrentpreviewshows343chars/585bytes/0variables; versiondrawerloads1version, nestedpreviewshowsexacthistoricalbody, Close/Escape returnsunchangedsavedstate. No globaltemplateedit/reset/restore.
- PC /admin/agent readonlyloads47capabilities,0pending/uncertain/succeeded,manifestfresh/runtimevalidated47; readenabled butwrite/external-sideeffect/privilegeoperationsdisabled. Emergencydisable untouched. This diagnostic read doesnotcertify all47capabilities or change flags.

- Continuation evidence: mobile branch selection retained the same QA branch and returned to its dashboard after loading; no other branch selected. Read-only chat prompt requested only this QA branch customer count, forbidding PII/mutations/sends; visible answer was 2, matching known fixtures. Read-only agent_trace query for this branch after 2026-09-18T01:03:00Z returned zero rows. Because /chat can select legacy or agent shell, this proves displayed answer only, not a durable capability execution receipt.
- Mobile contract preview follow-up: clicked existing QA contract PDF download once and receipt PNG download once with download listeners registered before each click. Both listeners timed out (20s PDF, 15s PNG); no visible error appeared, and PDF follow-up console error list was empty. Actual saved files remain UNVERIFIED; event timeout alone does not establish an application defect or successful save. No resend, cancellation, signature or new document.
