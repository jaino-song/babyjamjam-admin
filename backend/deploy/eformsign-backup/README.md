# 전자서명 일일 백업

Node.js 20 이상에서 매일 한국 시간 03시에 검토 단계(제공인력 검토 요청 070·반려 071)와 완료된 문서의 PDF를 보관합니다. 서비스계약서는 산모 서명이 끝나 검토 단계에 들어간 때부터, 제공기록지는 검토 단계부터 저장합니다. 감사추적은 eformsign이 완료 시점에 만들므로 문서가 완료되면 추가됩니다.

설치 (서버의 실행 사용자 계정 기준):

1. `backup.mjs`, `provider-contract-paths.mjs`, `provider-contract-migration.mjs`, `provider-contract-publication.mjs`를 함께 `~/eformsign-backup/`에, service와 timer를 `~/.config/systemd/user/`에 복사합니다. `mkdir -p ~/.config/eformsign-backup ~/.local/state/eformsign-backup`을 실행하고, `settings.example.json`을 `~/.config/eformsign-backup/settings.json`으로 복사해 URL·경로·원격 저장소를 수정합니다. 경로는 절대 경로를 사용합니다.
2. `sudo apt install rclone qpdf`로 도구를 설치합니다.
3. `rclone config`에서 Google Drive 원격 저장소를 만들고 사용자가 최초 한 번 Google에 로그인합니다.
4. 서버에 설정된 백업 전용 bearer 토큰을 `tokenFile` 경로의 파일에 저장하고 `chmod 600 ~/.config/eformsign-backup/token`을 실행합니다. 토큰을 명령 인자에 넣지 않습니다. 같은 값이 운영 API의 `EFORMSIGN_BACKUP_TOKEN`(LightNode `/opt/babyjamjam-fallback-server/backend.env`)에 있어야 하며, 운영 API는 이 값을 다음 배포 때 읽습니다. 그 전까지 백업 API는 404를 돌려줍니다.
5. `systemctl --user daemon-reload`를 실행하고 `loginctl enable-linger "$USER"`로 로그아웃 후에도 예약 실행이 유지되게 합니다. 타이머는 아직 켜지 않습니다.
6. 문서 20건까지만 수동으로 실행해 디스크·Drive·관리자 화면에 결과가 보이는지 확인합니다. 예약 실행과 겹치지 않게 같은 잠금을 사용합니다.

   ```sh
   flock -n ~/.local/state/eformsign-backup/run.lock node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --limit 20
   ```

7. 같은 명령을 `--limit 20` 없이 실행해 전체 백업을 한 번 끝냅니다. 종료 코드가 `0`이어야 합니다.
8. 개수를 맞춰 봅니다. 운영 DB의 "검토 단계 + 완료 문서 수"가 결과 보고의 `totalDocs`와 같고, `archiveDir`의 PDF 수(`find <archiveDir> -name '*.pdf' | wc -l`, 문서 파일 수 + 존재하는 감사추적 파일 수)와 Drive의 파일 수(`rclone size <rcloneRemote>`)가 같아야 합니다. 하나라도 다르면 타이머를 켜지 않고 원인을 먼저 찾습니다.
9. 개수가 맞고 결과가 `success`일 때만 `systemctl --user enable --now eformsign-backup.timer`로 매일 실행을 켭니다.

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

`stateDir/state.json`(version 2)은 문서별 경로·크기·내용 지문을 기록합니다. version 1은 첫 정상 실행에서 version 2로 변환하며, 기존 항목을 완료 상태로 간주합니다. 예약 실행은 `rclone copy --checksum`과 `--include '*.pdf'`로 PDF만 복사합니다. `rcloneRemote`가 없으면 Drive 복사를 건너뛰고 부분 완료로 보고합니다.

제공인력 계약서의 새 경로 확정 도중 작업이 중단되면 다음 예약 실행이 `stateDir/provider-contract-publication.json`의 경로를 이어서 사용합니다. 복구가 경로 충돌이나 파일 검증 실패로 중단되면 종료 코드 `1`을 반환하고 Drive 복사를 건너뜁니다. 원인을 확인하는 동안 저널과 `archiveDir/.provider-publication-*`에 남은 임시 데이터를 보존합니다.

복원은 필요한 PDF를 그대로 열면 됩니다. 병합된 기록의 서명 원본은 `제공기록지/원본/`에 있습니다.

종료 코드: `0` 정상 완료, `2` 일부 문서 실패·Drive 실패/생략·제한으로 미조회 페이지가 남음, `1` 목록 조회 실패 또는 설정·초기화 오류, `3` 결과 보고 POST가 재시도까지 실패. `--limit` 실행은 `limited: true`로 보고합니다. 로그와 실패 여부는 `systemctl --user status eformsign-backup.service`에서 확인합니다. 예약 해제는 `systemctl --user disable --now eformsign-backup.timer`이며 보관 파일은 그대로 남습니다.


## 완료된 기존 제공인력 계약서 이동

1. 메타데이터를 제공하는 API를 먼저 배포하고, 위 설치 절차의 워커 파일을 함께 설치합니다. 기존 타이머와 동일한 `~/.local/state/eformsign-backup/run.lock`이 있어야 합니다. 새 설치에서 잠금 파일이 아직 없으면 설치 절차의 수동 백업을 먼저 실행합니다. `stateDir`은 `archiveDir` 밖에 둡니다.
2. 실행 계정으로 dry-run을 수행합니다. 출력에는 이동 가능한 쌍의 수와 건너뛴 수가 표시됩니다. 기존 `기타` 쌍은 현재 완료 문서의 지문과 로컬·Drive의 두 파일 SHA-256이 모두 일치해야 합니다. 실패 사유가 나오면 해당 경로를 운영자만 열람할 수 있는 환경에서 조사합니다.

   ```sh
   node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --migrate-provider-contracts
   ```

3. 이동하는 동안 다른 작업에서 동일한 아카이브나 Drive 경로를 변경하지 않습니다. 아래 명령이 로컬과 Drive에 새 쌍을 만들고 SHA-256을 확인한 뒤 상태를 교체합니다. 이후 이전 파일도 SHA-256을 다시 확인하고 해당 경로만 삭제합니다. 기존 경로는 이름 예약에 남습니다.

   ```sh
   node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --migrate-provider-contracts --apply
   ```

   중단되거나 Drive 요청이 실패하면 원인을 해결한 뒤 같은 `--apply` 명령을 다시 실행합니다. 진행 중인 저널이 있으면 예약 실행은 운영자 재시도를 기다립니다. 이동 명령은 타이머 잠금을 직접 잡습니다. dry-run, 적용 또는 대상 없음이 정상 완료되면 `0`, 잠금 경합, 충돌, 복사나 검증 실패 시 `1`을 반환합니다.

4. 적용 이후 dry-run에서 이동 대상이 0건인지 확인합니다. `systemctl --user start eformsign-backup.service`로 평소와 같은 백업을 실행하고 종료 코드와 Drive 결과를 확인합니다.

롤백은 마지막 적용 배치에 대해 실행합니다. 적용이 중단된 상태라면 먼저 같은 적용 명령으로 끝까지 재시도합니다. 롤백은 현재 할당과 새 쌍의 로컬·Drive SHA-256을 확인하고 이전 경로에 검증된 쌍을 복원합니다. 그 뒤 해당 문서의 이전 상태를 기록하고 검증된 새 경로만 제거합니다. 롤백이 중단되면 같은 명령을 재실행합니다.

```sh
node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --migrate-provider-contracts --rollback
```

`stateDir/provider-contract-migration/`의 접근 제한된 `journal.json`과 `pre-state-<id>.json`을 보관합니다. 배치 이후 문서 상태가 바뀌거나 복원할 경로가 점유되어 롤백이 거부되면 저널의 전후 경로와 적용 전 상태 사본을 대조해 운영 복구 여부를 결정합니다. 상태 파일만 되돌리면 이미 제거된 로컬·Drive 파일 경로를 가리킬 수 있으므로 양쪽에서 복원된 PDF 해시를 확인한 뒤 상태를 갱신합니다.
