# 200개 목록의 파일 선택·읽기 피드백 수정

2026-10-16 KST · BJJ-354 · 실제 Galaxy 검수 중 발견한 진단 UI 문제.

## 관측과 범위

사용자는 기존 녹음을 눌러도 반응이 없다고 보고했다. 기기의 가명 기록은 6개
(MANUAL_SCAN 5, SAMPLE 1)였고 READ_PROBE는 없었다. 고정 UI 문구만 추려 확인한 화면에는
scan/start 버튼과 200개 표시가 있었지만 읽기 버튼은 보이지 않았다.

기준 소스 `2daff5d3e5f1b57ce4e5332be2c277d9582cc546`에서 선택 안내·읽기 버튼·statusView가
200개 파일 행 **뒤**에 배치돼 있었다. 파일 선택 메시지 자체는 기록되지만 화면 밖에 있어
선택이 되지 않은 것처럼 보였다. 같은 현상을 synthetic 201-file AVD에서 재현했다.
사용자가 누른 정확한 UI 요소를 원격 기록만으로 단정하지는 않는다.

## 최종 변경

* 후보: `e8251f2ed715cddf25acfe1ba789611a75987f14` / 실험 PR #827.
* Execution: LUNA / gpt-5.6-luna / max. 독립 Sol PLAN brief APPROVE 후 단일 unit에서 구현.
* Audit: SELF. main이 누적 diff와 통합 빌드, AVD 화면·이벤트를 검증했다.
* 수정 파일은 `experiments/helper-saf-spike/app/src/main/java/com/babyjamjam/helper/safspike/MainActivity.kt` 하나다.
* 기존 안내·읽기 버튼·결과를 파일 목록 앞의 패널로 묶었다.
* 파일 선택 후 한 번의 pre-draw에서 갱신된 레이아웃을 사용해 패널을 고정 safe-area viewport에 맞춰 표시한다.
* 파일 선택만으로는 읽거나 관찰을 중지하지 않는다. 기존 명시적 probe 버튼만 읽기를 수행한다.
* 기존 `probeSelectedFile()` 본문이 기준 소스와 byte-for-byte 동일함을 검사했다.
  grant, cancellation/generation fence, report/codec, 200/201 한도, 문자열, manifest, 의존성은 불변이다.

## 최종 후보 검증

명시적 JDK 17/ANDROID_HOME으로 testDebugUnitTest, lintDebug, assembleDebug를 offline 실행:
BUILD SUCCESSFUL. JVM 14개, 실패/오류/skip 0. lint 오류 0, 기존 경고 3.
git diff --check, APK v2 서명, manifest requested permission 없음 확인.

API37 ARM64 Pixel 7 AVD, 201개의 synthetic 파일 폴더에서 다음을 확인했다.

| 조건 | 결과 |
|---|---|
| 파일 미선택 | probe 비활성 |
| 목록 아래쪽 파일 선택 | 패널로 이동, 선택된 synthetic 이름과 활성 probe가 함께 보임 |
| 선택만 수행 | READ_PROBE 4개가 그대로 4개; 자동 읽기 없음 |
| probe 명시적 클릭 | READ_PROBE 5개로 증가, READ_ONE_BYTE 및 성공 문구 |
| 2초 관찰 중 | probe 비활성, 관찰 중지 활성 |
| 글자 크기 1.5배 | 안내·선택 문구·버튼이 status bar 아래에서 온전히 보임 |
| 검사 종료 | AVD font_scale 1.0으로 복원 |

최종 보통 글자 패널 top=136px, probe bounds=[42,236][1038,362].
1.5배에서도 패널 top=136px, probe bounds=[42,361][1038,499].
화면을 직접 열어 clipping과 상태표시줄 겹침이 없는지 확인했다.

[증거 디렉터리](probe-feedback-2026-10-16/)의 01은 수정 전, 02~03은 중간 후보이며
최종 통과 근거는 04~07이다. 중간 후보의 부분 clipping을 발견해 viewport 정렬을 보완했으며
그 화면을 최종 통과로 사용하지 않았다. 실패한 후보의 화면도 함께 보존한다.

## Galaxy 업데이트

전달 APK: `babyjamjam-saf-diagnostic-probe-fix-20261016.apk` (Mac Download 폴더).
SHA-256: `e7287507dce07467e34658d7436d878afde6284f463e11fb93a50de355204e78`.

동일한 실제 Galaxy에 install -r 성공, COLD start / Status=ok 확인.
업데이트 전 가명 이벤트 6개가 그대로 보존됐으며, 설치본 APK를 다시 pull한 hash가 전달 APK와 같다.
앱 삭제·데이터 초기화·기존 녹음 변경은 수행하지 않았다. 사용자에게 다시 스캔 → 기존 녹음 선택 →
표시되는 1바이트 읽기 버튼 순서로 재검증했다. 사용자가 성공 문구를 확인했고 실제 store에도
**READ_PROBE / GRANTED / OK / READ_ONE_BYTE / entries=1**이 추가됐다. 전체 event는 8개이며
업데이트 전 6개 event가 그대로 prefix로 보존됐다. 실기기에서 사용자가 고른 기존 녹음의
선택·읽기 피드백과 1바이트 접근은 PASS다. 원본 내용이나 파일명은 증거에 포함하지 않았다.
사용자가 최종 가명 JSON 내보내기를 완료했다. 실제 Download 파일명은
`saf-diagnostic-report.json`이며, Mac의 Git 밖 비공개 위치에만 원본을 보관했다.
[실기기 집계 요약](galaxy-summary-2026-10-16.json)에 8개 이벤트와 읽기 성공 1개를 기록했다.
schema/HMAC 필드와 원본 URI·파일명 필드 부재 검사는 PASS, truncationMarker는 null이다.
목록 한도에 도달한 이벤트 7개가 있으므로 전체 목록은 여전히 INCOMPLETE다.

기존 APK `babyjamjam-saf-diagnostic-local-20261016.apk`(becf713f…c34c0f5)는 덮어쓰지 않고 보존했다.
실제 시험 통화, 기기 재부팅, Samsung 녹음 완료 판별은 여전히 NOT_RUN이다. Phase 0 OPEN이며
이 UI 수정·AVD 통과만으로 제품 출하나 실제 녹음 중/후 안전성을 보장하지 않는다.

## 보안·복구

security-review: 새 권한·외부 호출·secret·의존성 없음, 명시적 read 함수 불변,
env/local.properties ignored 확인. 실기기 파일명/전화번호/음성을 공개 증거로 저장하지 않았다.
UI 조사 때 기기 내 임시 hierarchy에서 고정 컨트롤의 문구·활성 상태·bounds만 반환했다.
스크린샷과 hierarchy 증거는 synthetic AVD에서만 저장했다.
복구는 UI commit 범위를 되돌려 같은 서명으로 재빌드하는 것이며 원본 녹음 삭제가 필요 없다.
