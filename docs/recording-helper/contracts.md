# Galaxy helper 계약 기준 — Phase 0 사전 점검

작성일: 2026-10-15 · 관련 작업: [BJJ-354](https://linear.app/jaino-studio/issue/BJJ-354)
상태: **계획 계약 이관 완료 / 현행 코드 binding 미완료 / 구현 미시작**

## 기준과 변경 범위

대상은 Android 17 갤럭시 업무 전용폰 한 대다. `native/`는 deprecated이며 새로운 앱은 독립 Kotlin/Jetpack Compose 프로젝트를 사용한다. 오디오 경로는 휴대폰 → Google Drive → 기존 n8n → 기존 backend → admin 통화 인박스다. 고객 등록은 사람의 확인을 거친다.

이 문서는 승인된 계획 §2.2–2.6의 계약을 저장소에 이관한다. API 경로·HTTP 상태는 계획의 제안이며 기존 prefix, 에러 envelope, 권한 decorator, transaction adapter와 연결된 구현 계약은 아직 아니다. 아래 API를 구현 완료나 현재 동작으로 해석하지 않는다. 후속 코드 작업은 `path-map.md`의 미해결 binding을 끝낸 뒤 시작한다.

| 정본 | Revision | 문서 |
|---|---|---|
| 제품 요구사항 | PRD v1.1 | [PRD](https://linear.app/jaino-studio/document/galaxy-helper-prd-v11-c4a6e8eed12e) |
| 구현 계획 | implementation-plan-v1.1 | [Implementation Plan](https://linear.app/jaino-studio/document/galaxy-helper-implementation-plan-v11-54de58cc6520) |
| 테스트 명세 | test-spec-v1.0 | [44개 테스트 케이스](https://linear.app/jaino-studio/document/galaxy-helper-test-specification-v10-01d719dd3f0b) |
| 독립 계획 검수 | review-v1.0 | [Plan Review](https://linear.app/jaino-studio/document/galaxy-helper-independent-plan-review-v10-cd06f1caebe1) |

정본 파일 SHA-256:

- PRD: `8a6e73c954e6fd80d10a1c0d94640647b849ef52833e319ce292e0329d5650c2`
- Plan: `a48520e2a4fe498fa36e7d9ffeea67f745aaa826044cf574ad03acb873cc7d7a`
- Test spec: `cfded1d19bbee40626fb711141e5fb9ca345d0e3a79807b3e441923627849698`

Linear의 Markdown 정규화와 별개로 위 해시는 원본 파일을 식별한다. 테스트 명세를 등록한 것은 테스트 실행이 아니다. 제품 테스트 44개와 실기기 증거는 모두 NOT_RUN이다.

## 구 이슈에서 폐기한 가정

- 휴대폰에서 backend로 오디오를 먼저 업로드하지 않는다.
- READ_MEDIA_AUDIO를 기본 요구 권한으로 두지 않는다. 사용자가 고른 폴더의 SAF 읽기 권한을 사용한다.
- Capacitor/React Native 선택이나 기존 mobile/native 전환은 이번 작업에 포함하지 않는다.
- Google 로그인 자체를 admin 로그인 또는 지점 승인으로 사용하지 않는다.
- Drive 업로드 성공만으로 운영 준비 완료나 고객 등록 완료로 표시하지 않는다.

## 승인된 계획의 계약 본문

아래 절 번호는 정본 Implementation Plan과 대응한다.

### 2.2 인증과 지점 승인

1. 앱이 무작위 verifier를 만들고 S256 challenge와 기기 표시명을 서버에 보낸다. 등록 요청 유효시간은 10분을 기본 계약으로 정한다.
2. 앱이 시스템 브라우저/Custom Tab으로 `/helper/connect?request=...`를 연다. 기존 이메일·카카오 로그인을 사용한다.
3. 웹은 서버가 허용한 지점만 표시한다. 기존 폰 교체는 현재 연결 버전을 보여주고 명시적으로 확인한다.
4. 서버가 권한·만료·기존 연결 버전을 검사하고 트랜잭션으로 하나의 연결 자리를 승인한다. 동시 승인에서 한 요청만 성공한다.
5. 앱으로 돌아오면 앱이 자신이 보관한 verifier로 일회용 교환을 수행한다. 앱은 좁은 범위의 opaque connection credential만 받는다.
6. 브라우저 복귀 링크는 앱을 깨우는 용도다. 링크에 웹 토큰·helper credential·verifier를 넣지 않는다. 복귀가 되지 않아도 앱 재실행으로 승인 상태를 이어 확인한다.

MVP 복귀 링크는 고정된 scheme/host/path의 custom URI로 충분하다. 다른 앱의 링크 가로채기가 승인이나 자격증명 수신으로 이어지지 않도록 등록 교환을 verifier에 묶는다. 전달된 request ID만 믿어 로컬 진행 요청을 바꾸지 않는다. 기존 `safe-return-path.ts`에는 helper의 정확한 상대 경로와 허용 쿼리만 추가하고 임의 return URL은 허용하지 않는다.

**교환 응답 유실:** 이미 소비한 교환은 새 자격증명을 자동 재발급하지 않는다. 앱은 “연결을 다시 승인해 주세요”로 이동하며, 같은 관리자가 미완료 연결을 명시적으로 교체한다. MVP에서 평문 자격증명을 서버에 보관해 재전송하는 회복 경로를 만들지 않는다.

자격증명은 충분한 난수의 opaque token으로 생성하고 서버에는 해시만 저장한다. 앱은 Android Keystore 기반으로 보호하며 backup/기기 이전에서 비밀·등록 verifier·Room 큐를 제외한다. helper token을 웹 세션 토큰과 구분하고, 기존 `/auth/token`·refresh 회전 정책을 재사용하거나 바꾸지 않는다. 웹 로그아웃은 helper 연결을 끊지 않는다.

### 2.3 서버 모델 — 세 종류로 제한

| 모델 | 핵심 필드·제약 |
|---|---|
| `HelperEnrollmentRequest` | request ID, challenge, expiresAt, 상태, 승인 사용자·지점, 승인 대상 connection version, consumedAt. 만료·일회용 소비를 서버에서 검사 |
| `CallRecordingHelperSource` | branchId unique, sourceId, connectionId/generation, 등록자·기기명, credentialHash, configVersion, 신고된 Google 계정·Drive folderId, 운영 준비·시험 상태, revokedAt |
| `HelperConnectionTest` | test ID/nonce, source·connection·configVersion·folder 스냅샷, 신고된 driveFileId, 판정, 실제 인박스 기록 참조, 확인 운영자·시각·증거 |

지점당 source 한 행을 유지하고 교체 시 connectionId/generation과 credential을 회전한다. 이전 credential은 새 연결을 조회·변경·철회할 수 없다. 활성 연결뿐 아니라 설정 중인 연결도 한 대 제한에 포함한다. 상세 기기 인벤토리·원격 관리·무제한 이력 테이블은 추가하지 않는다.

계정이나 Drive 폴더가 바뀌면 configVersion을 증가시키고 운영 준비·시험 확인을 무효화한다. 오래된 화면의 승인 요청은 버전 충돌로 거절한다. helper가 보낸 이메일·folderId는 **신고 값**이며 서버가 Google 소유권을 검증한 사실로 표시하지 않는다.

### 2.4 최소 API 계약

아래는 새 리소스 경로의 제안이며, 기존 API prefix·에러 envelope·권한 decorator는 Task 0.1에서 맞춘다. 스키마는 구현 전에 문서와 테스트 fixture로 고정한다.

| 호출 | 인증 | 역할과 실패 조건 |
|---|---|---|
| `POST /helper/enrollments` | 등록 시작 제한 적용 | challenge·기기명 → request ID, 만료시각, 승인 URL. 속도 제한·입력 길이 제한 |
| `GET /helper/enrollments/:id` | admin 웹 | 승인 화면용 요청과 허용 지점. 권한 없는 지점 데이터 노출 금지 |
| `POST /helper/enrollments/:id/approval` | admin 웹 | branchId·expected connection version·교체 확인. 기존 웹 CSRF 방어 사용 |
| `POST /helper/enrollments/:id/exchange` | verifier 증명 | 승인 대기는 202, 만료는 410, 거절은 403, 소비 완료는 409. 성공 시 일회용 credential 반환 |
| `GET /helper/connection` | helper | 자신의 지점·연결 버전·설정/시험 상태만 조회 |
| `PUT /helper/connection/drive` | helper | expected configVersion과 새 계정·폴더 신고. 준비·시험 무효화 |
| `POST /helper/connection/tests` | helper | 운영 준비 후 시험 시도 발급. request idempotency key로 응답 유실 시 같은 시도 반환 |
| `PUT /helper/connection/tests/:id/upload` | helper | 같은 시도의 driveFileId 보고. 다른 ID로 덮어쓰기 금지, 확인 완료 판정 권한 없음 |
| `DELETE /helper/connection` | helper | 현재 credential의 연결만 철회. 반복 요청을 안전하게 처리 |
| `GET /branches/:id/recording-helper` | 해당 지점 관리 권한 | 현재 연결·설정·시험 상태와 철회 가능한 연결 표시 |
| `POST /branches/:id/recording-helper/operator-ready` | 운영 설정 권한 | 현재 connection/configVersion의 workflow·폴더·토큰 연결 확인 기록 |
| `POST /branches/:id/recording-helper/tests/:testId/verification` | 운영 확인 권한 | 같은 버전의 실제 Drive 파일·인박스 도착 증거로 승인/실패 판정 |
| `DELETE /branches/:id/recording-helper/connection` | 지점 관리 권한 | expected connectionId로 원격 철회. 구 화면이 새 폰을 철회하면 409 |

성공·오류 모두 안정된 error code를 둔다. 인증 실패, 연결 철회, 설정 변경, 운영 대기, 시험 대기, 외부 서비스 재승인을 구분한다. helper credential로 다른 지점, 고객, 기존 수집 토큰, n8n credential에 접근하는 테스트는 반드시 실패해야 한다. 등록·교환·철회 응답은 캐시하지 않고 token과 verifier를 로그에서 제거한다.

**helper 권한의 명시적 allow-list:** 자기 연결의 설정·상태 조회, Google 계정/Drive 폴더 설정 신고, 시험 시도 생성·업로드 결과 보고, 자기 연결 해제만 허용한다. 쓰기는 현재 connection/configVersion에 묶고, 지점 승인·교체와 운영 준비·실제 도착 판정은 웹의 별도 관리 권한으로만 수행한다. 이전 generation이나 철회된 credential로 새 연결을 변경할 수 없다. PRD v1.1과 동일한 계약이며, 허용 연산 성공과 범위 밖 연산 실패를 모두 테스트한다.

### 2.5 Google Drive와 운영 확인

앱은 Google AuthorizationClient로 계정과 `drive.file` 접근을 연결한다. 계정 선택 결과만 믿지 않고 같은 접근 토큰의 Drive `about.get` 사용자 정보로 실제 계정을 대조한다. `permissionId`를 계정 식별 기준으로 보관하고 이메일은 표시용으로 사용한다. 같은 계정 재승인에서 식별자가 다르면 기존 큐에 전송하지 않는다. 해당 정보가 확인되지 않으면 완료를 차단한다.

앱이 지점용 폴더를 생성하고 운영 Google 계정에 reader 권한을 준다. 공유 실패 시 준비 완료가 아니다. 폴더 생성도 미리 발급한 ID를 저장해 응답 유실로 폴더를 계속 만들지 않도록 한다. 운영 계정 주소는 서버 설정에서 내려주며 APK에 운영 비밀을 넣지 않는다. backend에는 Google refresh token을 새로 보관하지 않는다.

운영자는 기존 `docs/n8n/call-transcription-branch-template.json` 방식으로 폴더 ID, 기존 Google OAuth credential, 지점 call-ingest token을 연결한다. `cit_...`는 기존 발급 API에서 한 번 받아 n8n credential에 저장한다. 앱에 주지 않는다. 기존 webhook payload에 branchId를 추가하지 않는다. 지점은 기존 수집 토큰에서 결정한다.

시험 파일명에는 서버 test nonce를 식별 가능한 접두사로 붙인다. 원본 파일명은 폰에서 변경하지 않는다. **Drive 업로드 보고만으로 READY를 주지 않는다.** 운영자는 실제 부모 폴더·시험 식별자·n8n 실행·의도한 지점의 같은 driveFileId 인박스 기록을 확인한다. 서버는 현재 configVersion과 시험 snapshot, 같은 branch/file ID의 실제 CallRecord를 확인한다. 부모 폴더 확인은 MVP에서 운영자 증거로 남긴다. 자동 Google 소유권 검증 서비스는 만들지 않는다.

시험 파일이 다른 지점에 도착하면 실패 처리하고 workflow/토큰 연결을 수정한다. 잘못 도착한 기록은 운영자가 시험 기록으로 정리하며 고객 등록을 진행하지 않는다. 일반 녹음 자동 전송은 계속 차단한다.

기준 commit의 `backend/prisma/schema.prisma`에서 `call_record.driveFileId`는 전역 `@unique`다. 같은 ID의 두 지점 행이 동시에 존재한다는 전제로 새 검증 시스템을 만들지 않는다. 이 제약을 보존하고, 잘못된 지점에 먼저 저장된 같은 ID는 의도한 지점의 시험 확인에서 거절한다. 재수집이 기존 행의 지점을 덮어쓰지 않는지와 동시 수집의 단일 행 결과를 회귀 테스트한다. 실제 배포 DB의 migration 적용 여부는 실행 preflight에서 확인한다.

### 2.6 Android 상태와 전송 규칙

| 영역 | 최소 상태 |
|---|---|
| 연결 | 설정 중 → 운영 준비 대기 → 시험 가능 → 인박스 확인 대기 → 준비 완료 / 철회 |
| 로컬 동작 | 설정 중 → ACTIVE ↔ PAUSED → DISCONNECT_PENDING → DISCONNECTED |
| 전송 항목 | STABILIZING → QUEUED → UPLOADING → SUCCEEDED / RETRY_WAIT / ACTION_REQUIRED / CANCELLED |
| 표시용 대기 사유 | 오프라인, Wi-Fi 정책, 폴더 권한, Google 재승인, Drive 공간·공유, 서버 연결 확인 불가 |

상태의 유일한 저장 원천은 Room이다. WorkManager를 별도 업무 큐처럼 취급하지 않는다. 앱 실행·수동 검사·주기 검사 모두 같은 scanner와 queue processor를 호출한다. 원자적 점유와 단일 전송 경로로 중복 실행을 차단하고, 프로세스 재시작 시 이전 UPLOADING 항목을 같은 ID로 복구한다.

**로컬 테이블:** ConnectionSnapshot/SyncSettings, KnownRecording, UploadJob. UploadJob에는 sourceId·connection generation·configVersion·지점·Google permissionId·Drive folderId·원본 문서 ID·URI·크기/변경 정보·상태·시도·예약 Drive ID·재개 정보가 필요하다. 연결 세대+원본 문서 ID에 고유 제약을 둔다. 원본 변경이나 provider ID 변경은 자동으로 새 통화로 단정하지 않는다.

**활성화:** 폴더의 기존 문서 목록을 끝까지 읽고 한 트랜잭션으로 기준선과 활성 시점을 저장한 뒤 ACTIVE로 전환한다. 중간 실패는 미활성 상태로 남긴다. 시험 파일·기존 파일은 자동 큐에서 제외한다. 수정 시각만으로 신규를 판정하지 않는다. 초기 목록 조회 중 통화하지 않도록 시작 화면에서 짧게 안내하고, 늦게 표시되는 녹음·이름 변경·문서 ID 변화는 실기기 spike에서 검증한다.

**완료 판별:** 여러 시점의 크기·수정 시각·읽기 가능 여부를 확인하되, 두 번 같은 크기라는 사실만으로 통화 종료를 보장하지 않는다. 정확한 안정화 조건은 실제 삼성 전화 앱의 저장 동작을 근거로 결정한다. 녹음 중 완결 파일처럼 보이는 현상을 안전하게 구분할 수 없다면 자동 전송 출시 gate를 통과시키지 않고 PRD를 개정한다. 마이크/통화기록 권한을 조용히 추가하지 않는다.

**전송:** 파일 안정화 → 원본 fingerprint 고정 → Drive ID 예약 및 Room 저장 → 재개 가능한 업로드 → 서버 응답/Drive 파일 대조 → 성공 저장 순서다. 응답 유실·세션 만료·재시도에서도 저장된 같은 ID를 유지한다. 존재 여부만으로 성공하지 않고 예상 크기·checksum·부모 폴더 등 사용 가능한 메타데이터를 대조한다. 원본이 전송 전·중에 바뀌면 성공으로 처리하지 않는다. 불완전한 파일이 n8n에 노출되지 않는지 spike에서 확인한다.

**백그라운드:** WorkManager의 주기 실행과 네트워크 제약을 사용한다. 통화 종료 즉시나 15분 이내 전송을 약속하지 않는다. 기본은 모바일 데이터 허용, 선택은 Wi-Fi 전용이다. `UNMETERED`와 실제 Wi-Fi는 같은 뜻이 아니므로, Wi-Fi 전용 옵션은 전송 시작과 재개 때 실제 transport도 확인한다. 강제 종료 후 자동 실행은 보장하지 않으며 재실행 시 보충 검사한다.

**변경·해제:** 일시정지는 기준선과 큐를 유지한다. 다른 계정 변경은 모든 미완료 항목이 0일 때만 가능하고 새 운영 설정·시험·활성화를 거친다. 계정 변경 전부터 작업을 멈추고, 이전 항목의 대상 값을 덮어쓰지 않는다. 폴더 복구는 같은 논리 폴더와 원본 식별자를 확인하며, 다른 폴더로 바뀌면 조용히 기준선을 초기화하지 않고 재설정 경로로 이동한다.

연결 해제는 로컬 동작 중단·큐 취소를 먼저 영속 저장한 뒤 예약 작업을 취소한다. 오프라인이면 credential을 해제 요청용으로만 보관하고 온라인 복귀 후 서버 철회를 완료한다. 서버는 철회된 credential의 hash를 최소한 현재 연결 철회 확인에 쓸 수 있도록 유지하거나 명시적인 terminal 응답 계약을 제공한다. 예전 credential이 새 연결을 철회하지 못해야 한다. 서버 확인 후 비밀을 지운다. 이미 시작된 외부 전송은 완료될 수 있음을 UI에 표시한다.

전송을 새로 시작하거나 재개하기 전에는 서버 연결 유효성과 버전을 확인한다. 확인할 수 없으면 대기한다. 원격 철회를 오프라인에서 즉시 알아내거나 진행 중인 Google 요청을 즉시 중단한다고 보장하지 않는다. 서버 설정의 비활성화도 동일한 대기 경로를 사용한다.


## 다음 단계에서 반드시 고정할 항목

1. 기존 HTTP prefix/에러 envelope/웹 CSRF·지점 권한과 각 API의 실제 controller/service 경로.
2. credential 철회의 반복 요청 terminal 응답과 구 generation의 처리. 민감 토큰을 응답 fixture나 로그에 넣지 않는다.
3. 기존 migration/test adapter에 맞춘 schema 변경 경로와 동시 승인·교체·철회 회귀 fixture.
4. 실제 대상 Galaxy에서 확인한 원본 문서 ID/이름 변경/완료 판별 규칙. 안정된 크기만으로 완료를 선언하지 않는다.
5. Android 빌드 조합과 OAuth 등록의 실제 package/signing binding.

일반 녹음, 실제 계정 비밀, 전화번호, raw 문서 URI는 이 사전 점검 문서에 첨부하지 않는다. 시험 증거에는 합성 녹음과 익명화된 파일 식별자를 사용한다.
