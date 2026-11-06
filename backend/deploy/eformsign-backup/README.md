# 문서 백업 worker 설치 준비 자산

이 디렉터리는 비활성 소스 예제다. 파일 작성·로컬 CLI 검사만으로 설치, 초기화,
활성화 또는 운영 인수가 완료되지 않는다. 아래 명령은 후속 승인된 Linux 작업의
운영자용 절차이며, 이 소스 준비 작업에서는 실행하지 않는다.

## 1. 소스 준비와 설치 전 확인

- 앱 checkout은 `/home/covenant_labs_server/.local/share/bjj-backup/app`에 두고,
  독립 검토를 통과한 **정확한 release commit SHA**로 고정한다. 이동하는 branch/tag를
  실행 기준으로 삼지 않는다. 설치 기록에 SHA, lockfile, Node·pnpm 버전을 남긴다.
- 그 checkout의 workspace 전체에서 기존 `pnpm-lock.yaml`과 pnpm 설정을 사용해
  `pnpm install --offline --frozen-lockfile --ignore-scripts`로 의존성을 재현한다.
  승인된 캐시가 없으면 중단하고 공급 절차를 별도로 승인받는다. 전역 pnpm을 변경하거나
  lockfile을 갱신하지 않는다. 다른 checkout의 `node_modules`를 연결하지 않는다.
- 실행은 `backend/`에서 기존 `NODE_PATH=.` 및
  `/usr/bin/node -r ts-node/register/transpile-only scripts/eformsign-backup-worker.ts`
  진입점을 쓴다. raw TypeScript 공유 패키지도 이 경로로 로드한다. 별도 compiled worker
  경로나 새 build 명령을 가정하지 않는다.
- 사전 조사에서 SSH 사용자 `covenant_labs_server`, `/usr/bin/node`·`/usr/bin/flock` 존재,
  user manager linger=yes, root ext4 여유 약 293 GiB, 별도 archive mount 없음이 관찰되었다.
  이는 이전 조사 기록이며 이번 파일의 실행 증거가 아니다. 설치 시 다시 확인한다.
  linger를 켜기 위한 root 변경은 필요하지 않다.
- Main이 정확한 release의 unit 두 파일을 임시 Linux fixture에서
  `systemd-analyze --user verify`로 검증한 뒤 설치한다. 기존 C3 Linux CLI 검증은
  이 unit 정의의 검증을 대신하지 않는다.

## 2. 사용자 범위 설치와 비밀 전달

모든 실행·소유자는 `covenant_labs_server` 사용자다. system service나 root 설치가 아니다.
다음 디렉터리와 필요한 전용 부모 디렉터리를 소유자 전용 `0700`으로 준비하고,
기존 경로의 소유권·권한·symlink 여부를 확인한다. 알 수 없는 기존 데이터를 덮어쓰지 않는다.

| 용도 | 경로 |
| --- | --- |
| user unit | `~/.config/systemd/user/eformsign-backup.service`, `eformsign-backup.timer` |
| config | `~/.config/bjj-backup/worker.json` |
| export token | `~/.config/bjj-backup/secrets/export.token` |
| control·ledger·outbox·lock | `~/.local/state/bjj-backup/control` |
| archive | `~/.local/share/bjj-backup/archive` |
| 고정 release checkout | `~/.local/share/bjj-backup/app` |

unit 파일을 user unit 경로에 복사하고 `systemctl --user daemon-reload`만 수행한다.
이 단계에서 service나 timer를 start/enable하지 않는다. 예제 JSON은 `worker.json`으로
복사하되 `enabled: false`를 유지하고, config와 token은 사용자 소유 일반 파일 `0600`으로
보관한다. token을 unit, Environment/EnvironmentFile, 명령 인자, 저장소에 넣지 않는다.

기존 [credential CLI](../../scripts/eformsign-backup-export-credential.ts)의 `issue`는
raw token을 stdout에 출력한다. **터미널·CI·로그로 출력되는 방식으로 실행하지 않는다.**
발급에는 앱 DB 권한과 별도 release 승인이 필요하다. 승인된 후속 provisioning에서만
stdout을 소유자 전용 비공개 출력 경로로 직접 전달하고, raw token만 token 파일에 안전하게
전달한다(`token=` 라인 전체를 저장하지 않는다). 원문·중간 출력은 화면, 로그, 보고서에
남기지 않는다. 이 문서는 임의의 발급 shell 예제를 제공하지 않으며 자동 issue/revoke도 없다.

초기화 전에 예제 `exportBaseUrl`·`companyId`·`archiveId`를 검증된 release 값으로 교체한다.
URL의 실제 backend route와 회사·지점 입력은 배포된 앱 계약에서 확인하며 추측하지 않는다.
archive ID는 **설치마다 새 고유 UUID**를 할당한다. 예제 UUID를 실설치에 재사용하지 않는다.

`requireMountPoint: false`는 관찰된 동일 root 파일시스템 저장을 명시한다. control의
1 GiB/10,000 inode, archive의 10 GiB/100,000 inode는 각각의 여유 하한이며 용량 할당이 아니다.
둘은 root 용량을 공유하므로 별도 디스크 장애 복원력이나 독립 용량을 보장하지 않는다.
Drive 설정은 없고 활성화하지 않는다. NoDrive 결과는 `excluded`/`not_required`이며
Drive 백업 성공을 뜻하지 않는다.

## 3. 초기화: 비활성 설정으로 한 번만

timer가 정지된 상태에서 기존 control·archive와 marker·ledger를 먼저 확인한다.
archive marker는 `archive/.bjj-backup/installation.json`, control marker는
`control/installation.json`이다. 두 marker의
설치 ID·archive ID·ledger 상태를 함께 대조한다. 이미 초기화되었거나 출처가 불명확하면
다시 `init`하거나 reset하지 않는다. 불일치는 보존 후 별도 복구·대사 절차로 넘긴다.

확인된 새 디렉터리에 한해서, `enabled: false`인 실제 config로 backend 디렉터리에서
다음 초기화를 **한 번만** 수행한다. service와 동일한 lock을 사용한다.

```sh
cd /home/covenant_labs_server/.local/share/bjj-backup/app/backend
umask 077
NODE_PATH=. /usr/bin/flock -n -F -E 75 /home/covenant_labs_server/.local/state/bjj-backup/control/worker.lock \
  /usr/bin/node -r ts-node/register/transpile-only scripts/eformsign-backup-worker.ts init \
  --config /home/covenant_labs_server/.config/bjj-backup/worker.json
```

`init`은 비활성 설정에서도 Linux 파일시스템·lock을 검사하고 marker와 ledger를 쓴다.
완료 후 두 marker와 ledger의 ID를 확인하고 아래 읽기 전용 `inspect` 결과를 확인한다.
`inspect`는 lock이 필요 없지만 일관된 확인을 위해 timer가 정지된 상태에서 수행한다.

```sh
NODE_PATH=. /usr/bin/node -r ts-node/register/transpile-only scripts/eformsign-backup-worker.ts inspect \
  --config /home/covenant_labs_server/.config/bjj-backup/worker.json
```

반면 비활성 `process-pending`의 exit 0/`disabled`는 CLI 내부 lock·token·archive를 열기 전
반환한 결과다(내부 claimed=0). 초기화나 토큰·저장소 유효성을 증명하지 않는다.
unit의 외부 `flock`은 그보다 먼저 실행되므로 control 디렉터리는 비활성 상태에서도 필요하다.

## 4. 활성화와 운영 인수

실제 backend routes, DB migration, credential, 검증된 config가 배포·승인되고 초기화가
확인된 뒤에만 `enabled: true`로 변경하고 `0600`을 유지한다. 그 후 운영자가 실행한다.

```sh
systemctl --user enable --now eformsign-backup.timer
systemctl --user status eformsign-backup.timer eformsign-backup.service
```

service는 `process-pending --max-jobs 1`로 이미 큐에 들어온 요청만 처리한다.
기존 회사 전체 수집 `run`을 호출하지 않는다. `flock -n -F -E 75`는 Node가 직접 lock을
소유하게 하며 충돌 exit 75를 unit의 정상 종료로 취급한다. 다른 오류는 성공으로 숨기지 않는다.
timer는 부팅 후 30초, service가 비활성화된 뒤 15초를 기준으로 재실행하며 정확도는 1초다.
지속 실행·Restart·RemainAfterExit는 없다. monotonic timer이므로 `Persistent`를 사용하지
않고 누락된 시각의 실행을 소급 보장하지 않는다. timer 동작 중 수동 CLI를 병렬 실행하지 않는다.
별도 cron/worker도 같은 큐를 중복 소비하지 않도록 실행 소유자를 하나로 유지한다.

운영 인수에는 직원이 실제 앱에서 승인한 작은 선택 문서 요청이 접수되고 서버 worker에
claim된 증거, 로컬 PDF와 audit 파일 및 hash 검증, 공개 백업 이력의 결과를 함께 남긴다.
합성 테스트나 disabled 응답은 이 인수를 대신하지 않는다. 작은 요청 성공으로 전체 문서
coverage를 완료 처리하지 않는다. 실제 API/UI QA와 최종 release 승인은 Main의 별도 gate다.

## 5. 중단과 롤백

```sh
systemctl --user disable --now eformsign-backup.timer
systemctl --user stop eformsign-backup.service
```

timer를 먼저 멈춰 새 실행을 막고 service를 멈춘다. 이 unit은 기본 systemd 중단 동작을
사용한다. 기본적으로 control group에 SIGTERM을 보내고 stop timeout 후 SIGKILL할 수 있으며,
실제 timeout은 user manager 기본값에 따른다. 작업 완료나 graceful shutdown을 보장하지 않는다.
중단 시 pending 비공개 증거·binding·outbox가 남을 수 있으므로 서버 요청 상태와 ledger를
대사한 뒤 재개한다. `UMask=0077`·`NoNewPrivileges=true`만으로 sandbox나 OS 파일·네트워크
접근 격리가 성립한다고 주장하지 않는다.

ledger, outbox, archive, config, token을 모두 보존한다. 삭제·재초기화·알 수 없는 archive
reset은 롤백 절차가 아니다. 앱을 되돌릴 때도 저장 형식 호환성과 고정 release를 확인한다.
credential 폐기가 필요하면 별도 승인된 revoke 절차로 처리하고, 토큰 삭제로 대체하지 않는다.

## 검증 경계

이 네 파일은 설치·활성화 코드가 아닌 준비 자산이다. 로컬 config parse/disabled CLI와
기존 CLI 테스트는 소스 수준 근거다. UI 변경·설치된 서비스가 없어 이 유닛의 browser QA는
해당하지 않는다. 정확한 committed asset의 Linux systemd 검증, 실제 설치·credential 전달·
활성화, 최종 기능 API/UI QA·운영 인수·보호 release는 Main이 후속으로 수행해야 한다.
