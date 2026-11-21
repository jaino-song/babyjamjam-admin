# BJJ-354 로컬 Android 검수 — 2026-10-15~16 KST

**로컬 준비와 기본 에뮬레이터 시나리오를 실행했다. 실제 Galaxy 검증과 Phase 0 완료는 아직 아니다.**

## 대상과 재현 위치

* 진단 baseline: `61b9b2c0418f12a793e0c8e89d4f974ac6479909`.
* UI 수정 후보: `2daff5d3e5f1b57ce4e5332be2c277d9582cc546` ([실험 PR #827](https://github.com/jaino-song/babyjamjam-admin/pull/827)).
* checkout: `/Users/jaino/Documents/Codex/2026-10-15/new-chat/work/helper-saf-ui-review`.
* Studio에서 여는 프로젝트: 위 경로의 `experiments/helper-saf-spike`.
* Android Studio Rabbit 1 / 2026.2.1을 실제 실행하고 프로젝트 sync, app 설치·실행을 확인했다.
* AVD: `BJJ354_SAF_API37`, Pixel 7 profile, `sdk_gphone64_arm64`, Android 17/API 37,
  Google APIs arm64 system image revision 6, 1080×2400 portrait.
* SDK: `/Users/jaino/Library/Android/sdk`; platform 37.0 revision 2, build-tools 36.0.0,
  platform-tools 37.0.1, emulator 37.2.12.
* JDK 17.0.20.1+1: `/Users/jaino/.gradle/jdks/eclipse_adoptium-17-aarch64-os_x.2/jdk-17.0.20.1+1/Contents/Home`.
* Gradle 9.4.1 / AGP 9.2.1. 기존 앱의 의존성·SDK·manifest는 변경하지 않았다.

화면 조작은 먼저 macOS Computer Use로 진행했다. embedded emulator의 입력 전달이 불규칙하여
사용자가 ADB 검수를 명시적으로 승인한 뒤, 해당 AVD의 `input tap/swipe/keyevent`,
`uiautomator dump`, `screencap`으로 이어갔다. Google 로그인·운영 계정·실제 음성은 사용하지 않았다.
synthetic 시험 폴더만 `/sdcard/Download/safspike-test`에 만들었다.

## 로컬 빌드와 설치 artifact

진단 프로젝트에서 명시적 JAVA_HOME/ANDROID_HOME으로 다음 검사를 실행했다.

```sh
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --offline --no-daemon
```

* 최종 후보에서 **BUILD SUCCESSFUL**, JVM 14개, 실패/오류/skip 0.
* lint: 오류 0, 경고 3 — AndroidGradlePluginVersion, UnusedResources, MissingApplicationIcon.
  컴파일에도 기존 window API deprecation 경고 3개가 남는다.
* APK v2 signature 검증 PASS. manifest의 requested permission은 없음.
* 전달 파일: `/Users/jaino/Downloads/babyjamjam-saf-diagnostic-local-20261016.apk`.
* SHA-256: `becf713fbe1f5a39fcba1551f4e421380288d341f47b8a027a992ced7c34c0f5`.
* 최종 AVD 설치본을 다시 pull한 hash와 전달 APK의 hash가 같다.
* 이전 전달 APK의 hash/서명과 동일하다고 주장하지 않는다. 이번 Mac의 debug signing artifact다.

Studio 실행으로 manifest가 추가 가공된 초기 설치본은 전달 후보에서 제외했다. 명령줄에서 빌드한
APK를 다시 설치하고 최종 설치본 hash를 대조했다. Studio가 만든 미추적
`gradle/gradle-daemon-jvm.properties`는 프로젝트에서 제거해 task 임시 위치에 보존했고 커밋하지 않았다.

## 실행한 GUI 시나리오

baseline에서 기능을 확인하고, 아래 UI 수정 후 영향받는 화면/큰 글자와 선택·읽기를 다시 확인했다.
아래 표의 PASS는 적힌 조건에만 해당한다. 실패 주입이나 Samsung provider 검증을 포함하지 않는다.

| 시나리오 | 결과 | 증거 |
|---|---|---|
| 초기 화면·스크롤·큰 글자 | 수정 후 기본/1.5배 글자에서 상단·스크롤·하단 접근 PASS. 검사 후 font_scale=1.0 복원 | 11~14 PNG |
| SAF 취소·폴더 선택 | 취소 후 선택된 트리 없음, scan 비활성. synthetic 폴더 허용 후 읽기 권한 유지·scan 활성 PASS | 02, 15 PNG |
| 수동 조회·2초 관찰·중지 | 수동/주기 snapshot 생성, 시작/중지 버튼 상태 전환 PASS | 05 PNG, JSON의 MANUAL_SCAN/SAMPLE |
| 백그라운드·재실행·재부팅 | Home 이동 후 관찰 중지 안내, 재부팅 후 지속 읽기 권한 유지·재조회 PASS (AVD 한정) | 06, 08 PNG |
| 1바이트 읽기·JSON 저장 | 1-byte 파일 READ_ONE_BYTE, 0-byte 파일 EMPTY, JSON 저장/parse/가명 검사 PASS; 수정 후 sample.txt 읽기 재확인 | 03, 04, 16 PNG/XML |
| 폴더 교체·권한 해제 | small→limit 교체 성공. 해제 후 scan/read 비활성, 기존 16개 event가 17개 report의 prefix로 보존됨 PASS | 10 PNG, before/after JSON |
| 표시 한도 | 201개 synthetic 파일 폴더에서 200개 표시, entryCapReached=true snapshot 2개 PASS | 09 PNG, JSON |
| 단계·메타데이터 | RENAME/AFTER_REBOOT marker 보존, 파일 이름 변경 뒤 변화 안내 PASS; 동일 메타데이터를 녹음 완료로 표현하지 않음 | 07 PNG, JSON |

`providerLoading`, 실제 느린 provider, 이전 grant 해제 실패/재시도, 저장 실패, 256-event 저장 한도
초과는 이 GUI 세션에서 주입하지 않았다 (NOT_RUN). 기존 JVM 테스트의 실패 경로 검사와 GUI 실측은
별개다. 실제 통화 중·직후 녹음 안정화, Samsung 문서 ID 변화와 지연 노출은 NOT_RUN이다.

## 발견·수정한 화면 문제

baseline에서는 inset을 ScrollView의 자식 padding으로 적용해 스크롤하면 그 여백도 함께 이동했다.
따라서 단계 이름이 상태표시줄의 시계 아래에 그려졌다 (03/06 PNG).

* Execution: LUNA / `gpt-5.6-luna`, max; 격리 unit `fix/BJJ-354-saf-insets`.
* 독립 Sol brief 검토 APPROVE 후 MainActivity.kt 한 파일의 viewport/inset 처리만 수정했다.
* systemBars와 displayCutout inset을 고정 ScrollView에 적용하고 clipToPadding을 명시했다.
  자식의 16dp spacing과 SAF·권한·관찰·저장 동작은 유지했다.
* Audit: SELF. main이 5추가/3삭제 diff, 최종 14 tests/lint/build, 기본·1.5배 화면과 읽기 회귀를 확인했다.
  이전 진단 코드의 Sol SHIP을 새 SHA의 최종 Sol SHIP으로 확대하지 않는다.
* rollback은 이 UI commit만 되돌리는 범위이며 원본·진단 event·Drive/admin 데이터 삭제가 필요 없다.

보안 점검(`security-review`): 변경분에 credential·외부 endpoint·실행 경로 추가 없음,
manifest 권한·네트워크 기능·의존성 불변, env/local.properties가 ignored임을 확인했다.
기존 앱 전체에 대한 신규 보안 감사나 운영 데이터 검증을 했다는 뜻은 아니다.

## JSON 검사

`report-final.json`: schemaVersion 2, event 20개, event당 entries 최대 200,
entryCapReached snapshot 2개. 다음 assertion이 통과했다.

* 모든 entry id/nameFingerprint가 64자리 HMAC hex.
* 원본 시험 파일명, `content://`, `file://`, `/storage/`, 시험 폴더명이 report에 없음.
* entries ≤ 200, events ≤ 256.
* truncated = entryCapReached OR providerLoading OR legacyIncomplete.
* 해제 전 16개 event가 해제 후 report에 그대로 보존되고 REVOKE/MISSING event만 추가됨.

이 JSON에는 baseline과 수정 후 관찰이 함께 있다. export는 앱 기능으로 수행했고 내용을 고치지 않았다.
실제 음성이나 고객 파일을 관찰한 보고서가 아니다.

## 증거와 남은 일

증거 디렉터리는 세션 시작일을 이름으로 유지한다:
[local-emulator-2026-10-15](local-emulator-2026-10-15/).
[기계 검증 요약](local-emulator-2026-10-15/verification.json),
[최종 JSON](local-emulator-2026-10-15/report-final.json),
[수정 후 읽기 화면](local-emulator-2026-10-15/16-fixed-read-byte.png),
[큰 글자 하단](local-emulator-2026-10-15/14-fixed-large-bottom.png).

실제 Galaxy와 제품 44개 테스트, Google/Drive/n8n E2E는 NOT_RUN이다. Task 0.1의 API fixture,
승인 BFF write 방어, branch+driveFileId adapter, exact 구현 allow-list도 아직 남아 있다.
Phase 0 OPEN, Phase 1 미시작, dev 병합·운영 배포 없음. 원격 CI는 로컬 Gradle 검사와 별도로 판단한다.
