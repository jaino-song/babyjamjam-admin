# 전자서명 일일 백업

Node.js 20 이상에서 매일 한국 시간 03시에 검토 단계(제공인력 검토 요청 070·반려 071)와 완료된 문서의 PDF를 보관합니다. 서비스계약서는 산모 서명이 끝나 검토 단계에 들어간 때부터, 제공기록지는 검토 단계부터 저장합니다. 감사추적은 eformsign이 완료 시점에 만들므로 문서가 완료되면 추가됩니다.

## 설치와 전환

`archiveDir`과 Google Drive에는 이미지 전용 PDF를 게시합니다. 전자서명이 포함된 문서와 감사추적은 받은 바이트 그대로 비공개 원본 보관소에 남습니다. 서명 검증과 증빙에는 이 원본을 사용합니다. 공개 PDF는 열람용이며, 병합 PDF는 비공개 청크로 만든 별도 출력입니다.

1. 업그레이드할 때는 `systemctl --user stop eformsign-backup.timer`로 타이머를 멈춥니다. 실행 중인 백업이 끝나면 `systemctl --user stop eformsign-backup.service`를 실행하고 수동 작업도 모두 끝났는지 확인합니다. 이전 모듈과 service 파일을 보관합니다. **새 설치 전용**으로 `mkdir -m 700 -- "$HOME/eformsign-backup"`을 실행해 새 설치 경로를 만듭니다.

   **기존 설치가 `0755`인 경우** 설치 디렉터리가 이 백업 전용이고 설정·토큰·상태·잠금·공개 및 비공개 아카이브가 모두 그 밖에 있는지 확인합니다. 타이머와 서비스가 정지된 상태에서 실행 계정으로 아래 명령을 실행합니다. 기존 디렉터리를 새 `0700` 보관 디렉터리 아래로 옮기고 원래 위치에 새 `0700` 디렉터리를 만듭니다.

   ```sh
   (
     set -eu
     export LC_ALL=C
     umask 077
     uid=$(id -u)
     test "$uid" -ne 0
     test "$(realpath -e -- "$HOME")" = "$HOME"
     test "$(stat -c %u -- "$HOME")" = "$uid"
     parent="$HOME"
     while :; do
       owner=$(stat -c %u -- "$parent")
       mode=$(stat -c %a -- "$parent")
       test "$owner" = "$uid" || test "$owner" = 0
       test "$((0$mode & 07022))" -eq 0
       test "$parent" != / || break
       parent=$(dirname -- "$parent")
     done
     install_dir="$HOME/eformsign-backup"
     test "$(stat -c '%u:%a:%F' -- "$install_dir")" = "$uid:755:directory"
     previous=$(mktemp -d -- "$HOME/.eformsign-backup-previous.XXXXXXXX")
     printf '%s\n' "$previous/install"
     mv -T -- "$install_dir" "$previous/install"
     mkdir -m 700 -- "$install_dir"
   )
   ```

   출력된 경로를 기록합니다. 5단계에서 레거시 복구가 필요하면 이 경로의 `backup.mjs`와 이전 설정을 사용합니다. 전체 롤백을 완료한 뒤에는 보관한 이전 모듈을 현재 `0700` 설치 디렉터리에 복원합니다. 경로·소유자·권한 점검 또는 명령이 실패하면 전환을 멈추고 기존 경로와 보관 경로를 오프라인에서 확인합니다.

   새 설치와 업그레이드 모두 같은 릴리스의 저장소 루트에서 모든 모듈을 복사합니다. 설치 디렉터리가 실행 계정 소유의 `0700` 일반 디렉터리로 확인된 경우에만 복사합니다. `eformsign-backup.service`와 `eformsign-backup.timer`는 `~/.config/systemd/user/`에 둡니다.

   ```sh
   test "$(LC_ALL=C stat -c '%u:%a:%F' -- "$HOME/eformsign-backup")" = "$(id -u):700:directory" &&
   install -m 600 backend/deploy/eformsign-backup/*.mjs ~/eformsign-backup/
   ```

2. **새 설치 전용.** 아직 설정·상태·잠금 경로가 없는 경우에만 아래 명령으로 생성합니다. 이후 잠금 파일을 삭제하거나 교체하지 않습니다. 기존 설치에는 6단계의 권한 점검 명령을 사용합니다.

   ```sh
   install -d -m 700 ~/.config/eformsign-backup ~/.local/state/eformsign-backup
   (umask 077; set -C; : > ~/.local/state/eformsign-backup/run.lock)
   ```

3. 새 설치에서는 `settings.example.json`을 `~/.config/eformsign-backup/settings.json`으로 복사하고 실제 URL·절대 경로·원격 저장소를 설정합니다. 기존 설정은 service의 `--raster`로 전환됩니다. `originalArchiveDir`을 명시하면 스위치 없이도 라스터 모드입니다. 생략 시 절대 경로로 해석한 `archiveDir` 바로 뒤에 `.originals`를 붙입니다. 예를 들어 공개 경로가 `/home/USER/eformsign-archive`이면 기본 비공개 원본 경로는 `/home/USER/eformsign-archive.originals`입니다. 공개·원본·상태 경로는 서로 포함할 수 없으며 심볼릭 링크를 사용할 수 없습니다. 별도 `stateDir`도 실행 계정 소유, 모드 `0700`으로 준비합니다. 비공개 원본과 상태를 Drive 동기화, 웹 서버, 공유 폴더에서 제외합니다. 원본과 저널을 함께 비공개 백업합니다.
4. `sudo apt install ghostscript qpdf rclone util-linux`로 `gs`, `qpdf`, `rclone`, `flock`을 준비합니다. 필요하면 설정의 `gsBin`, `qpdfBin`, `rcloneBin`으로 실행 파일을 지정합니다. Drive를 사용하면 `rclone config`로 실행 계정의 Google Drive 원격 저장소를 설정합니다. `rcloneRemote`를 생략하면 공개 로컬 게시만 수행합니다.
5. 전환 전 기존 제공인력 계약서 이동 저널이 `applying` 또는 `rollingBack`이면, 이전 모듈과 설정으로 해당 방향을 끝냅니다. 기존 `provider-contract-publication.json` 또는 `provider-contract-prepared-stages.json`이 있으면 이전 정기 백업을 같은 잠금으로 실행해 복구합니다. 공개 트리의 `*.tmp`, `.provider-publication-*`, `.provider-contract-*`가 남아 있으면 실행을 멈춥니다. 출처와 복구 필요성을 오프라인에서 확인한 뒤 운영자가 승인한 파일만 비공개 격리 경로로 옮깁니다. 자동으로 삭제되는 파일은 없습니다.
6. **기존 설치 전용 권한 점검.** 타이머와 서비스가 정지된 상태에서 실행 계정으로 신뢰하는 본인 소유 설정 파일의 절대 경로를 넘깁니다. 결과에는 점검·변경 개수와 일반 사유만 표시됩니다. Dry-run이 종료 코드 `0`이면 잠금을 잡는 적용 명령을 실행합니다.

   ```sh
   node ~/eformsign-backup/prepare-raster-permissions.mjs --settings ~/.config/eformsign-backup/settings.json
   node ~/eformsign-backup/prepare-raster-permissions.mjs --settings ~/.config/eformsign-backup/settings.json --apply
   ```

   권한 도구는 검증한 본인 소유 상태·잠금 디렉터리와 기존 `run.lock`, `state.json`만 각각 `0700`, `0600`으로 제한합니다. 재귀 변경 없이 파일 이름·내용·inode와 공개 아카이브의 `0755`를 유지합니다. 재실행 시 이미 적용된 항목의 변경 건수는 0입니다. 종료 코드 `1`이면 전환을 멈추고 경로·소유자·잠금을 확인합니다. 그룹이나 다른 계정이 쓸 수 있는 디렉터리, 다른 계정이 쓸 수 있는 메타데이터, 쓰기 권한이 과도한 잠금 파일은 오프라인에서 원인과 출처를 먼저 확인합니다. 점검 후 경로가 교체되면 중단합니다. 교체가 늦게 일어났다면 일부 검증된 파일의 권한이 이미 제한됐을 수 있으므로 이전 권한으로 풀지 않습니다.

   새 설치는 권한 점검을 건너뛰고 여기서 시작합니다. 기존 설치는 권한 적용이 성공한 뒤 진행합니다. 타이머를 계속 정지한 상태에서 독립 라스터 dry-run과 전체 과거 자료 전환을 순서대로 실행합니다. 독립 전환 명령은 API와 토큰을 사용하지 않습니다. Dry-run은 파일을 생성하거나 수정하지 않습니다. 적용은 service의 3시간 제한과 별도로 실행해 완료를 기다립니다.

   ```sh
   node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --raster-archive
   node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --raster-archive --apply
   ```

   적용 명령도 같은 잠금에서 변경 없는 준비·게시 검사를 먼저 실행합니다. 검사를 통과하면 잠금 옆 `~/.local/state/eformsign-backup/raster-cutover.json`에 `preparing`을 기록합니다. 전체 게시를 검증하면 `active`가 됩니다. 개별 PDF만 변환에 실패하면 검증된 다른 PDF는 게시하고 `partial`을 기록한 뒤 종료 코드 `2`를 반환합니다. 실패한 경로에 전에 확인한 공개 파일이 있으면 로컬과 Drive 양쪽에 기존 바이트가 그대로 남습니다. 첫 전환에서는 서명 원본이 남을 수 있으므로 전체 전환을 확인할 때까지 공개 위치의 접근 범위를 관리합니다.

   `partial`에서도 같은 설정으로 `--raster-archive --apply`를 재시도하거나 정기 라스터 실행으로 신규 문서를 처리하고 실패한 PDF를 재시도할 수 있습니다. 정기 실행에서 목록을 빠짐없이 읽고 원본 처리와 게시 검증이 모두 끝나면 `active`로 전환합니다. Drive가 없는 설정에서도 로컬 게시를 검증하면 전환할 수 있습니다. 이때 결과는 Drive `skipped`와 종료 코드 `2`입니다. 결과 보고 POST의 성공 여부는 전환 상태와 별개입니다. 제공인력 계약서 이름 이동은 `active`에서만 가능합니다.

   게시 실패가 기록되기 전에 프로세스가 중단되거나 준비·게시의 전역 오류가 발생하면 `preparing`이 남을 수 있습니다. 동일한 공개·원본·상태·원격 설정으로 `--raster-archive --apply`를 다시 실행합니다. `preparing`에서는 정기 실행이 목록 조회나 다운로드 전에 중단됩니다. 마커가 있는 동안 레거시 복사는 거부됩니다. 마커는 수동으로 지우지 않습니다.
7. 서버의 백업 전용 bearer 토큰은 `tokenFile`에 모드 `0600`으로 저장합니다. 운영 API는 같은 값을 배포 시 읽습니다. 수동 제한 실행과 전체 실행으로 결과를 확인한 뒤 service를 새로 읽고 타이머를 켭니다.

   ```sh
   node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --raster --limit 20
   node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --raster
   systemctl --user daemon-reload
   loginctl enable-linger "$USER"
   systemctl --user enable --now eformsign-backup.timer
   ```

   전체 실행에서 목록 수와 관리자 화면의 `totalDocs`를 대조하고 공개·Drive의 PDF 경로가 일치하는지 확인합니다. Drive를 설정한 전체 실행은 `success`와 종료 코드 `0`이어야 합니다. Drive가 없는 구성은 로컬 게시 후 `partial`과 종료 코드 `2`를 반환합니다.

정기 실행, 수동 라스터 명령, 제공인력 계약서 이동은 동일한 `run.lock`을 내부에서 한 번 잡습니다. 이 명령을 외부 `flock`으로 감싸면 잠금 경합으로 종료 코드 `1`을 반환합니다. 전환 전의 레거시 정기 실행만 외부에서 잠급니다.

레거시 복구가 필요한 경우 보관한 이전 모듈과 `originalArchiveDir` 및 `gsBin`이 없는 이전 설정으로 필요한 명령을 실행합니다. 아래 정기 명령은 중단된 경로 확정을 복구합니다. 마지막 두 명령 중에는 저널에 기록된 방향 하나만 사용합니다.

```sh
flock -n ~/.local/state/eformsign-backup/run.lock /usr/bin/env node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json
node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --migrate-provider-contracts --apply
node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --migrate-provider-contracts --rollback
```

`archiveDir`의 폴더 구성:

```text
서비스계약서/서비스계약서_{고객명}_{시작일}.pdf
서비스계약서/감사추적/[감사추적]_{동일한 이름}.pdf
제공기록지/제공기록지_{고객명}_{시작일}.pdf
제공기록지/감사추적/[감사추적]_{동일한 이름}.pdf
제공기록지/원본/제공기록지_{고객명}_{시작일}_{청크번호}장.pdf
제공기록지/원본/감사추적/[감사추적]_{동일한 청크 이름}.pdf
제공인력 계약서/제공인력_계약서_{을성명}_{계약서명날짜}.pdf
제공인력 계약서/감사추적/[감사추적]_제공인력_계약서_{을성명}_{계약서명날짜}.pdf
기타/{문서명}.pdf
기타/감사추적/[감사추적]_{동일한 이름}.pdf
```

eformsign 템플릿 이름이 정확히 `제공인력 계약서`이고 `제공인력 성명`, `계약년`, `계약월`, `계약일`이 모두 확인되면 예를 들어 `제공인력 계약서/제공인력_계약서_김관리_2026-05-01.pdf`로 보관합니다. 처음 백업할 때 값이 없거나 서로 모순되면 eformsign 문서명으로 `기타`에 보관합니다. 이미 이름이 배정된 문서는 다음 목록에서 필드가 빠져도 경로 예약을 유지합니다. 안내문 등 다른 문서도 eformsign 문서명으로 `기타`에 보관합니다. 파일명이 겹치면 PDF와 감사추적에 같은 ` (2)`, ` (3)` 접미사를 붙입니다.

검토 중인 제공인력 계약서의 이름이 처음 확정되거나 바뀌면 새 경로의 파일을 검증한 뒤 현재 상태를 갱신합니다. 이전 경로와 파일은 로컬과 Drive에 남습니다. 기존 이름이 계속 유효한 검토 문서는 내용이 달라지면 같은 경로를 갱신하고, 감사추적은 처음부터 예약한 경로에 추가합니다. 완료 상태로 저장한 파일의 내용이 이후 바뀌면 새 경로를 배정하고 이전 기록을 `state.json`의 `<키>@<지문>`에 남깁니다. 목록에서 사라진 문서의 파일도 보존합니다. 분할 제공기록지는 모든 청크가 모이면 날짜 순서로 병합하고, 병합 감사추적은 모든 청크에 감사추적이 생기면 생성합니다.

`stateDir/state.json`(version 2)의 배정 경로·크기·지문은 비공개 원본 기준입니다. version 1은 첫 정상 실행에서 version 2로 변환하며 기존 항목을 완료 상태로 간주합니다. 다운로드와 이름 배정은 비공개 보관소에서 이루어집니다. qpdf는 `/tmp/eformsign-backup-qpdf-*`의 실행 계정 소유 `0700` 임시 디렉터리에서 병합하고, 작업자는 결과를 비공개 보관소에 확정합니다. 강제 종료로 임시 디렉터리나 비공개 보관소의 병합 `*.pdf.<UUID>.tmp`가 남으면 실행이 모두 끝난 뒤 소유자·권한·출처를 확인한 해당 항목만 정리합니다. 공개 로컬과 Drive는 게시 모듈이 갱신합니다. 게시만 실패하면 같은 명령을 재시도해 로컬 원본을 다시 사용합니다.

라스터 모드에서 완료 문서의 새 버전이나 제공인력 계약서의 새 경로 확정이 중단되면 다음 정기 실행이 `stateDir/provider-contract-publication.json`과 `provider-contract-prepared-stages.json`에 기록된 소유권을 확인하고 원본 검사를 시작하기 전에 복구합니다. 영수증이 남아 있으면 독립 전환·롤백과 계약서 이름 이동을 먼저 실행할 수 없습니다. 복구가 경로 충돌이나 파일 검증 실패로 중단되면 상태와 저널, 비공개 원본의 `.provider-publication-*` 작업 파일을 유지합니다. 이전 버전에서 저널 없이 중단된 하드링크가 있으면 타이머를 멈춘 뒤 원본 트리·상태·저널을 함께 보존하고 검증된 백업과 오프라인에서 대조합니다. 기록으로 소유권을 확인할 수 없는 링크나 작업 파일을 추정해 지우지 않습니다.

개별 라스터 실패 로그와 결과에는 전체 실패 파일 수 `failedFiles`와 최대 10개의 라스터 실패 상세가 기록됩니다. 상세의 `raster:<16자리 16진수>`는 보관 상대 경로에서 계산한 불투명 식별자입니다. 동일한 경로는 재시도할 때 같은 식별자를 갖습니다. 전자서명 서비스의 문서 ID와 원본 파일명은 이 라스터 상세에 들어가지 않습니다. 변환에 실패한 파일은 비공개 원본이 정상적으로 저장되어 있는 경우에 다시 처리할 수 있습니다.

종료 코드: `0` 정상 완료, `2` 일부 문서 실패·Drive 실패/생략·제한으로 미조회 페이지가 남음, `1` 목록 조회 실패 또는 설정·초기화 오류, `3` 결과 보고 POST가 재시도까지 실패. `--limit` 실행은 `limited: true`로 보고합니다. 로그와 실패 여부는 `systemctl --user status eformsign-backup.service`에서 확인합니다. 예약 해제는 `systemctl --user disable --now eformsign-backup.timer`이며 보관 파일은 그대로 남습니다.


## PDF 준비 이벤트 전달

운영 전환 승인이 끝나고 양쪽 게시 경로와 라스터 상태가 `active`로 확인된 설치에서 사용자 타이머를 추가할 수 있습니다. 기존 03:00 KST 전체 작업과 타이머는 계속 실행합니다. 설치·업그레이드 중에는 설치된 백업 타이머와 서비스를 모두 멈춘 뒤 같은 버전의 `.mjs` 파일 및 유닛을 복사합니다.

```sh
install -m 600 backend/deploy/eformsign-backup/eformsign-backup-ready-events.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now eformsign-backup-ready-events.timer
```

- 첫 준비 조회는 UTC 기준 최근 24시간입니다. 이후 완료한 상한에서 5분을 겹쳐 읽습니다. 각 실행은 고정 구간의 장부 페이지를 최대 50개씩 두 번 읽고 대상은 최대 8개 처리합니다. 페이지의 대기 항목과 다음 커서는 `stateDir/ready-events.json`에 소유자 전용으로 함께 기록합니다. 새 대상에 처리 기회를 우선 배정하고, 나머지는 재시도 시각 순으로 처리합니다. 재시도는 30초에서 최대 30분까지 늘어납니다.
- 장부 보존 및 재조회 범위는 최대 90일입니다. 범위를 벗어난 대기 항목은 집계의 `expired`에 기록되며 03:00 KST 전체 조회에서 다시 확인합니다. 5분 겹침보다 늦게 보인 장부 행과 장부에 기록되지 않은 문서에도 전체 조회가 적용됩니다. 쓰기가 실패하면 마지막으로 저장된 커서에서 재개합니다.
- 조회만 한 실행에는 아카이브 스캔과 일일 이력 POST가 없습니다. 대상 원본을 확보할 때는 정확한 두 경로와 검증된 바이트의 소유권을 `state.json`에 기록합니다. 중단된 예약은 다음 이벤트 실행이나 현재 원본을 확인한 일일 실행에서 재사용합니다. 현재 원본을 증명할 수 없는 비공개 파일은 예약과 함께 보존합니다.
- 완료 문서는 본문과 감사추적이 모두 현재 미러 리비전이어야 합니다. 준비된 청크 원본의 래스터 사본은 먼저 게시할 수 있습니다. 같은 지점·케이스·스냅샷의 전체 청크와 감사추적이 준비되면 첫 세션 순으로 병합합니다. 게시 직전과 전달 확인 전 API에서 원본을 다시 확인합니다. Drive와 로컬에서 확인한 결과만 `delivered`로 집계합니다. 집계는 사용자 서비스 저널에 남습니다.
- Drive 설정 누락, 미완료 전환·이동, 원격 중단 또는 잠금 경합 중에는 게시가 대기합니다. 타이머는 부팅 후와 실행 종료 후 약 30초 간격으로 동작합니다. KST 02:56부터 03:01 직전까지는 03:00 작업에 잠금을 넘깁니다. 시작 제한은 120초, 정지 유예는 10초입니다. 전달 시간에는 미러 준비와 큐, 변환, 네트워크 상태 및 정기 작업 대기가 모두 포함됩니다.

이벤트 실행을 중지하려면 `systemctl --user disable --now eformsign-backup-ready-events.timer`로 추가 타이머를 끄고 실행 중인 `eformsign-backup-ready-events.service`가 끝났는지 확인합니다. 복구에 필요한 상태와 비공개 파일은 보존합니다.

## 완료된 기존 제공인력 계약서 이동

전환 후 이동은 비공개 원본 쌍의 SHA-256과 현재 이름 배정을 확인합니다. 신규 적용과 dry-run은 권위 있는 전체 API 목록이 필요합니다. Dry-run은 이동 예정 쌍을 검사하고 공개 경로 충돌을 검증합니다.

```sh
node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --raster --migrate-provider-contracts
node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --raster --migrate-provider-contracts --apply
node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --raster --migrate-provider-contracts --rollback
```

원본 이름을 바꾸기 전에 게시 모듈이 이동할 문서와 감사추적 쌍만 검증합니다. 이동 경로와 방향을 저널에 기록하고 원본과 배정을 갱신한 뒤 새 공개 PDF를 검증하고 이전 파생본을 제거합니다. 양쪽 파일이 검증되어야 저널의 게시 대기가 해제됩니다. 폐기된 문서명과 감사추적 경로는 유니코드 NFC 기준으로 예약됩니다. 같은 이름의 다른 문서에는 비어 있는 다음 접미사가 배정되며, 원래 쌍은 같은 문서 키·지문·배정을 검증한 이동이나 역이동에서만 기존 이름을 되찾을 수 있습니다. 원본 이동이 진행 중이면 정기 실행과 전체 아카이브 롤백은 종료 코드 `1`로 거부됩니다. 이때 같은 설정으로 이동을 시작한 `--raster --migrate-provider-contracts --apply` 또는 `--raster --migrate-provider-contracts --rollback`을 먼저 재실행하고, 성공한 뒤 정기 실행이나 전체 롤백을 다시 시도합니다. 원본 이동이 끝나면 정기 실행도 미완료 게시를 재개할 수 있습니다. 이름 롤백은 마지막 적용 배치를 대상으로 하며, 원본 이동과 게시를 재개할 때는 API 토큰이 필요 없습니다. 복원 경로가 점유됐거나 원본 또는 할당이 바뀐 경우, 저널과 `pre-state-<id>.json`을 비공개 환경에서 함께 확인합니다.

전환 전 완료된 이동 저널은 `stateDir/provider-contract-migration/records/pre-raster-<id>-<phase>.json`에 보존됩니다. 전환 시 그 저널의 ID와 단계도 기록합니다. 과거 레거시 이동을 취소할 계획이면 전환 전에 실행합니다. 이미 전환한 경우 아래 전체 롤백을 먼저 완료하고, 활성 저널 자리가 비어 있는지 확인합니다. 기록된 경로·상태·해시가 실제 복원 자료와 일치할 때만 보존 저널을 `provider-contract-migration/journal.json`으로 복사하고 모드 `0600`을 설정한 뒤 이전 버전에서 레거시 `--migrate-provider-contracts --rollback`을 실행합니다. 보존본과 적용 전 상태 사본은 유지합니다.

## 아카이브 전환 전체 롤백

타이머를 정지하고 서비스가 끝날 때까지 기다립니다. 제공인력 계약서 이동이나 경로 확정이 중단된 경우 해당 작업부터 끝냅니다. 이름까지 이전으로 되돌려야 하면 위 이름 롤백을 먼저 실행합니다.

```sh
node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --raster-archive --rollback
```

롤백은 비공개 원본을 공개 로컬과 설정된 Drive에 복원하고 검증합니다. 서명 원본이 공개 위치에 다시 나타나는 작업이므로 이전 서비스로 돌아가는 시점과 공개 위치 접근을 먼저 조율합니다. 실패하면 전환 마커가 남으므로 동일한 설정으로 같은 롤백을 재시도합니다. 성공하면 정리된 라스터 이동 저널은 `records/post-raster-<id>-<phase>.json`에 보존되고 전환 마커가 제거됩니다.

최초 `preparing`에서는 매니페스트와 비공개 원본·작업 기록이 없다는 점을 잠금 안에서 검증한 경우에만 전환을 취소할 수 있습니다. 이전 이동 저널이 분리돼 있었다면, 같은 보존본을 활성 저널 자리에 다시 연결하고 검증한 뒤 마커를 제거합니다. 이미 연결된 상태에서 재시도해도 동일한 기록인지 확인합니다. 원본이 일부라도 수집됐거나 매니페스트가 누락된 기존 전환인지 판단할 수 없으면 마커와 파일을 유지합니다. 타이머와 서비스를 멈춘 상태에서 비공개 원본·상태·매니페스트·공개 자료의 스냅샷을 보존합니다. 같은 설치에 속하는 검증된 매니페스트와 상태 백업을 복원하고 같은 명령을 재시도합니다. 최초 수집 중 중단된 경우에는 수집본과 원본이 일치하도록 검증된 사본을 복원한 뒤 `--apply`로 이어갈 수 있습니다. 일치하는 자료가 없으면 보존한 스냅샷으로 오프라인에서 대조합니다. 활성 마커가 남아 있는 동안 원본 경로를 바꾸거나 새 경로를 만들어 우회하지 않습니다.

성공을 확인한 뒤에만 이전 모듈·service를 복원하고, 필요하면 보존 저널을 위 절차로 복구합니다. 이전 service는 `--raster` 없이 같은 `run.lock`을 외부 `flock`으로 잡습니다. 호출하는 설정에서 `originalArchiveDir`과 `gsBin`을 제거한 뒤 `systemctl --user daemon-reload`를 실행합니다. 이전 버전으로 같은 잠금을 사용하는 단일 백업의 결과를 확인한 뒤 타이머를 재시작합니다. 다시 라스터 자료로 전환할 때는 독립 `--raster-archive --apply`를 실행합니다. 검증된 롤백 뒤 레거시 실행이 공개 원본을 갱신했다면 현재 레거시 상태의 문서 및 감사추적 SHA-256과 크기를 증거로 사용합니다. 중단 후 재시도하려면 이 증거가 이전 시도와 같아야 합니다. 공개 로컬과 Drive가 서로 다르거나, 변경된 병합 PDF처럼 유효한 개별 출처 증거가 없으면 재전환이 거부됩니다. 이전 매니페스트와 비공개 원본을 보존하고 검증된 일치 사본을 복구한 후 재시도합니다.
