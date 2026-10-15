# SAF 진단 스파이크 증거

이 문서는 `experiments/helper-saf-spike`의 독립 진단 APK에 대한 코드 준비 증거입니다. 생산용 녹음 도우미나 Phase 0 완료 판정의 증거가 아닙니다.

## 코드와 구성

- 애플리케이션 ID: `com.babyjamjam.helper.safspike`
- API: min/compile/target 37
- AGP: 9.2.1
- Gradle: 9.4.1
- Kotlin: AGP 9 내장 Kotlin 컴파일러 사용, 별도 `kotlin-android` 플러그인 없음
- 권한: 매니페스트에 위험 권한과 서비스 권한 없음; SAF 트리의 영구 읽기 grant만 요청
- 백업: `allowBackup=false`, cloud backup 및 device transfer 전용 상태 제외

구현은 직접 자식 문서의 nullable 크기/수정 시각, 200개 제한과 공급자 loading 상태, 메타데이터 변화 판정, 설치별 HMAC 지문, 정규화된 공급자 오류, 1바이트 읽기 확인, 백그라운드 전환 시 관찰 중지, 로컬 grant 해제를 포함합니다. 보고서는 사용자가 고른 `ACTION_CREATE_DOCUMENT` 위치로만 기록하며 완료/업로드 동작은 없습니다.

## 코드 검증

검증 명령과 결과는 다음과 같습니다.

```text
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --no-daemon
git -c core.whitespace=cr-at-eol diff --cached --check
```

결과: **PASS** (2026-10-15, Gradle 9.4.1/JDK 17)

- `:app:testDebugUnitTest`: PASS
- `:app:lintDebug`: PASS, 0 errors and 2 warnings (`UnusedResources` for `unknown_status`, `MissingApplicationIcon`)
- `:app:assembleDebug`: PASS
- APK: `experiments/helper-saf-spike/app/build/outputs/apk/debug/app-debug.apk`
- Kotlin 컴파일은 API 30 이후 deprecated 된 세 가지 `Window` 색상/edge-to-edge API 경고를 냈습니다.
- 현재 JVM 테스트 수: 14개 PASS (DiagnosticModelTest 11개, GrantLifecycleTest 3개)
- `git -c core.whitespace=cr-at-eol diff --cached --check`: PASS

### F1 grant lifecycle fix

The replacement/revoke lifecycle now verifies the currently selected grant before
taking a replacement. A failed release keeps the selected URI and grant so the
user can retry; the candidate is not taken in that case. Revoke clears private
state only after a missing grant is verified, including the case where another
actor already revoked it. The diagnostic releases only its selected URI.

Focused JVM regression tests cover A→B→revoke, failed replacement release with
retry, and failed revoke with retry. F1 verification on 2026-10-15 passed
`./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --no-daemon`
with the installed JDK 17/Gradle 9.4.1 toolchain; its baseline lint result was
0 errors and 2 warnings. Samsung hardware validation remains NOT_RUN.

### F2/F3 scan fix

Scans and one-byte read probes now run off the UI thread through a cancellable
single-worker queue. Backgrounding, stopping observation, tree replacement, or
revoke invalidates pending results; a generation token, captured stage, and
captured URI are checked before any UI, snapshot, selected-file, or event-store
mutation. Direct-child enumeration reads at most 201 provider rows, including
directories, to distinguish the 200-row entry cap from provider loading without
claiming an exhaustive count. These two flags are preserved separately in new
events and reports; legacy events keep an explicit unknown-incomplete marker.
The sampling timer skips ticks while a SAMPLE scan is in flight, so a slow
provider query can still commit an observation; stopping observation invalidates
that pending sample. F2/F3 and sampling-liveness verification is included in the
14 passing JVM tests above. Samsung hardware validation remains NOT_RUN.

## Samsung HW 검증

이 세션에는 연결된 Samsung 실기기가 없고 에뮬레이터 KVM도 없습니다. 다음 항목은 모두 **NOT_RUN**입니다.

| ID | 내용 | 상태 |
| --- | --- | --- |
| SAF-01 | 트리 선택 및 영구 읽기 grant 재확인 | NOT_RUN |
| SAF-03 | 2초 관찰, 백그라운드 중지, 재부팅 후 grant 확인 | NOT_RUN |
| SAF-04 | 이름 변경과 nullable metadata 관찰 | NOT_RUN |
| SAF-05 | 앱 선택 트리 grant 해제 및 가명 이벤트 보존 | NOT_RUN |

실기기 검증 전에는 이 스파이크에서 SAF 동작을 확인했다고 보고하지 않습니다.
