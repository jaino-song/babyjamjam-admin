# 전자서명 일일 백업

Node.js 20 이상에서 매일 한국 시간 03시에 검토 단계(제공인력 검토 요청 070·반려 071)와 완료된 문서의 PDF를 보관합니다. 서비스계약서는 산모 서명이 끝나 검토 단계에 들어간 때부터, 제공기록지는 검토 단계부터 저장합니다. 감사추적은 eformsign이 완료 시점에 만들므로 문서가 완료되면 추가됩니다.

## 설치와 전환

`archiveDir`과 Google Drive에는 이미지 전용 PDF를 게시합니다. 전자서명이 포함된 문서와 감사추적은 받은 바이트 그대로 비공개 원본 보관소에 남습니다. 서명 검증과 증빙에는 이 원본을 사용합니다. 공개 PDF는 열람용이며, 병합 PDF는 비공개 청크로 만든 별도 출력입니다.

1. 실행 계정의 `~/eformsign-backup/`에 `backup.mjs`, `provider-contract-paths.mjs`, `provider-contract-migration.mjs`, `provider-contract-publication.mjs`, `raster-mirror.mjs`, `raster-render.mjs`를 함께 설치합니다. `eformsign-backup.service`와 `eformsign-backup.timer`는 `~/.config/systemd/user/`에 둡니다. 업그레이드 전에는 타이머를 정지하고 실행 중인 서비스가 끝날 때까지 기다립니다. 되돌릴 수 있도록 이전 모듈과 service 파일을 보관합니다.
2. 실행 계정으로 접근 제한된 설정·상태 디렉터리와 공용 잠금 파일을 준비합니다. 실행 중인 서비스·운영자 명령이 모두 끝난 상태에서 준비하고, 이후 잠금 파일을 삭제하거나 교체하지 않습니다.

   ```sh
   install -d -m 700 ~/.config/eformsign-backup ~/.local/state/eformsign-backup
   (umask 077 && touch ~/.local/state/eformsign-backup/run.lock)
   chmod 600 ~/.local/state/eformsign-backup/run.lock
   ```

3. 새 설치에서는 `settings.example.json`을 `~/.config/eformsign-backup/settings.json`으로 복사하고 실제 URL·절대 경로·원격 저장소를 설정합니다. 기존 설정은 service의 `--raster`로 전환됩니다. `originalArchiveDir`을 명시하면 스위치 없이도 라스터 모드입니다. 생략 시 절대 경로로 해석한 `archiveDir` 바로 뒤에 `.originals`를 붙입니다. 예를 들어 공개 경로가 `/home/USER/eformsign-archive`이면 기본 비공개 원본 경로는 `/home/USER/eformsign-archive.originals`입니다. 공개·원본·상태 경로는 서로 포함할 수 없으며 심볼릭 링크를 사용할 수 없습니다. 별도 `stateDir`도 실행 계정 소유, 모드 `0700`으로 준비합니다. 비공개 원본과 상태를 Drive 동기화, 웹 서버, 공유 폴더에서 제외합니다. 원본과 저널을 함께 비공개 백업합니다.
4. `sudo apt install ghostscript qpdf rclone util-linux`로 `gs`, `qpdf`, `rclone`, `flock`을 준비합니다. 필요하면 설정의 `gsBin`, `qpdfBin`, `rcloneBin`으로 실행 파일을 지정합니다. Drive를 사용하면 `rclone config`로 실행 계정의 Google Drive 원격 저장소를 설정합니다. `rcloneRemote`를 생략하면 공개 로컬 게시만 수행합니다.
5. 전환 전 기존 제공인력 계약서 이동 저널이 `applying` 또는 `rollingBack`이면, 이전 모듈과 설정으로 해당 방향을 끝냅니다. 기존 `provider-contract-publication.json` 또는 `provider-contract-prepared-stages.json`이 있으면 이전 정기 백업을 같은 잠금으로 실행해 복구합니다. 공개 트리의 `*.tmp`, `.provider-publication-*`, `.provider-contract-*`가 남아 있으면 실행을 멈춥니다. 출처와 복구 필요성을 오프라인에서 확인한 뒤 운영자가 승인한 파일만 비공개 격리 경로로 옮깁니다. 자동으로 삭제되는 파일은 없습니다.
6. 타이머가 정지된 상태에서 dry-run과 전체 과거 자료 전환을 실행합니다. 세 독립 전환 명령은 API와 토큰을 사용하지 않습니다. Dry-run에는 파일 생성이나 수정이 없습니다. 적용은 전체 자료를 처리하므로 service의 3시간 제한과 별도로 아래 명령을 실행해 완료를 기다립니다.

   ```sh
   node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --raster-archive
   node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --raster-archive --apply
   ```

   잠금 옆 `~/.local/state/eformsign-backup/raster-cutover.json`은 전환 작업 전에 기록되고 게시 검증이 끝나면 `active`가 됩니다. 중단되면 동일한 공개·원본·상태·원격 설정으로 같은 적용 명령을 재시도합니다. 마커가 존재하는 동안 레거시 복사는 거부됩니다. 마커를 수동으로 지우지 않습니다. 정기 실행에는 `active` 전환이 필요하며, 준비 단계에서 실패하면 목록 조회나 PDF 다운로드 없이 실패를 보고합니다.
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

`stateDir/state.json`(version 2)의 배정 경로·크기·지문은 비공개 원본 기준입니다. version 1은 첫 정상 실행에서 version 2로 변환하며 기존 항목을 완료 상태로 간주합니다. 다운로드와 병합, 제공인력 계약서의 이름 배정과 임시 저장은 모두 비공개 보관소에서 이루어집니다. 공개 로컬과 Drive는 게시 모듈이 갱신합니다. 게시만 실패하면 같은 명령을 재시도해 로컬 원본을 다시 사용합니다.

제공인력 계약서의 새 경로 확정이 중단되면 다음 정기 실행이 `stateDir/provider-contract-publication.json`을 사용해 이어서 처리합니다. 복구가 경로 충돌이나 파일 검증 실패로 중단되면 저널과 비공개 원본 보관소의 `.provider-publication-*` 임시 데이터를 보존합니다.

종료 코드: `0` 정상 완료, `2` 일부 문서 실패·Drive 실패/생략·제한으로 미조회 페이지가 남음, `1` 목록 조회 실패 또는 설정·초기화 오류, `3` 결과 보고 POST가 재시도까지 실패. `--limit` 실행은 `limited: true`로 보고합니다. 로그와 실패 여부는 `systemctl --user status eformsign-backup.service`에서 확인합니다. 예약 해제는 `systemctl --user disable --now eformsign-backup.timer`이며 보관 파일은 그대로 남습니다.


## 완료된 기존 제공인력 계약서 이동

전환 후 이동은 비공개 원본 쌍의 SHA-256과 현재 이름 배정을 확인합니다. 신규 적용과 dry-run은 권위 있는 전체 API 목록이 필요합니다. Dry-run은 이동 예정 쌍을 검사하고 공개 경로 충돌을 검증합니다.

```sh
node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --raster --migrate-provider-contracts
node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --raster --migrate-provider-contracts --apply
node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --raster --migrate-provider-contracts --rollback
```

이동 전에 게시 기준을 검증하고 문서·감사추적 각각의 이동 경로와 방향을 저널에 기록합니다. 검증된 원본 쌍에 맞춰 상태와 이름을 갱신한 뒤 게시 모듈이 새 공개 PDF를 검증하고 이전 파생본을 제거합니다. 중단되면 같은 방향의 명령을 재실행합니다. 이전 방향의 원본 이동이 끝나면 정기 실행도 미완료 게시를 재개할 수 있습니다. 이동 중인 원본이 있으면 완료될 때까지 정기 실행과 전체 아카이브 롤백이 대기합니다. 이름 롤백은 마지막 적용 배치를 대상으로 하며, 원본 이동과 게시를 재개할 때는 API 토큰이 필요 없습니다. 복원 경로가 점유됐거나 원본 또는 할당이 바뀐 경우, 저널과 `pre-state-<id>.json`을 비공개 환경에서 함께 확인합니다.

전환 전 완료된 이동 저널은 `stateDir/provider-contract-migration/records/pre-raster-<id>-<phase>.json`에 보존됩니다. 전환 시 그 저널의 ID와 단계도 기록합니다. 과거 레거시 이동을 취소할 계획이면 전환 전에 실행합니다. 이미 전환한 경우 아래 전체 롤백을 먼저 완료하고, 활성 저널 자리가 비어 있는지 확인합니다. 기록된 경로·상태·해시가 실제 복원 자료와 일치할 때만 보존 저널을 `provider-contract-migration/journal.json`으로 복사하고 모드 `0600`을 설정한 뒤 이전 버전에서 레거시 `--migrate-provider-contracts --rollback`을 실행합니다. 보존본과 적용 전 상태 사본은 유지합니다.

## 아카이브 전환 전체 롤백

타이머를 정지하고 서비스가 끝날 때까지 기다립니다. 제공인력 계약서 이동이나 경로 확정이 중단된 경우 해당 작업부터 끝냅니다. 이름까지 이전으로 되돌려야 하면 위 이름 롤백을 먼저 실행합니다.

```sh
node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --raster-archive --rollback
```

롤백은 비공개 원본을 공개 로컬과 설정된 Drive에 복원하고 검증합니다. 서명 원본이 공개 위치에 다시 나타나는 작업이므로 이전 서비스로 돌아가는 시점과 공개 위치 접근을 먼저 조율합니다. 실패하면 전환 마커가 남으므로 동일한 설정으로 같은 롤백을 재시도합니다. 성공하면 정리된 라스터 이동 저널은 `records/post-raster-<id>-<phase>.json`에 보존되고 전환 마커가 제거됩니다.

성공을 확인한 뒤에만 이전 모듈·service를 복원하고, 필요하면 보존 저널을 위 절차로 복구합니다. 이전 service는 `--raster` 없이 같은 `run.lock`을 외부 `flock`으로 잡습니다. 호출하는 설정에서 `originalArchiveDir`과 `gsBin`을 제거한 뒤 `systemctl --user daemon-reload`를 실행합니다. 이전 버전으로 같은 잠금을 사용하는 단일 백업의 결과를 확인한 뒤 타이머를 재시작합니다. 다시 라스터 자료로 전환할 때는 독립 `--raster-archive --apply`를 실행합니다.
