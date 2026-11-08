# 전자서명 일일 백업

Node.js 20 이상에서 매일 한국 시간 03시에 완료된 계약서와 제공기록지 PDF를 보관합니다.

설치 (서버의 실행 사용자 계정 기준):

1. `backup.mjs`를 `~/eformsign-backup/`에, service와 timer를 `~/.config/systemd/user/`에 복사합니다. `mkdir -p ~/.config/eformsign-backup ~/.local/state/eformsign-backup`을 실행하고, `settings.example.json`을 `~/.config/eformsign-backup/settings.json`으로 복사해 URL·경로·원격 저장소를 수정합니다. 경로는 절대 경로를 사용합니다.
2. `sudo apt install rclone qpdf`로 도구를 설치합니다.
3. `rclone config`에서 Google Drive 원격 저장소를 만들고 사용자가 최초 한 번 Google에 로그인합니다.
4. 서버에 설정된 백업 전용 bearer 토큰을 `tokenFile` 경로의 파일에 저장하고 `chmod 600 ~/.config/eformsign-backup/token`을 실행합니다. 토큰을 명령 인자에 넣지 않습니다. 같은 값이 운영 API의 `EFORMSIGN_BACKUP_TOKEN`(LightNode `/opt/babyjamjam-fallback-server/backend.env`)에 있어야 하며, 운영 API는 이 값을 다음 배포 때 읽습니다. 그 전까지 백업 API는 404를 돌려줍니다.
5. `systemctl --user daemon-reload`를 실행하고 `loginctl enable-linger "$USER"`로 로그아웃 후에도 예약 실행이 유지되게 합니다. 타이머는 아직 켜지 않습니다.
6. 문서 20건까지만 수동으로 실행해 디스크·Drive·관리자 화면에 결과가 보이는지 확인합니다. 예약 실행과 겹치지 않게 같은 잠금을 사용합니다.

   ```sh
   flock -n ~/.local/state/eformsign-backup/run.lock node ~/eformsign-backup/backup.mjs --settings ~/.config/eformsign-backup/settings.json --limit 20
   ```

7. 같은 명령을 `--limit 20` 없이 실행해 전체 백업을 한 번 끝냅니다. 종료 코드가 `0`이어야 합니다.
8. 개수를 맞춰 봅니다. 운영 DB의 완료 문서 수가 결과 보고의 `totalDocs`와 같고, `archiveDir`의 PDF 수(`find <archiveDir> -name '*.pdf' | wc -l`)와 Drive의 파일 수(`rclone size <rcloneRemote>`)가 같아야 합니다. 하나라도 다르면 타이머를 켜지 않고 원인을 먼저 찾습니다.
9. 개수가 맞고 결과가 `success`일 때만 `systemctl --user enable --now eformsign-backup.timer`로 매일 실행을 켭니다.

`archiveDir`의 폴더 구성:

```text
서비스계약서/서비스계약서_{고객명}_{시작일}.pdf
서비스계약서/감사추적/{동일한 이름}.pdf
제공기록지/제공기록지_{고객명}_{시작일}.pdf
제공기록지/감사추적/{동일한 이름}.pdf
제공기록지/원본/제공기록지_{고객명}_{시작일}_{청크번호}장.pdf
제공기록지/원본/감사추적/{동일한 청크 이름}.pdf
기타/{문서명}.pdf
기타/감사추적/{동일한 이름}.pdf
```

제공인력 계약서나 안내문처럼 고객 계약서도 제공기록지도 아닌 문서는 eformsign 문서명 그대로 `기타`에 보관합니다. 이름이 겹치거나 재발행되면 ` (2)`, ` (3)`을 붙여 원본을 보존합니다. 분할 기록은 모든 청크가 모이면 날짜 순서로 병합합니다. `stateDir/state.json`은 재실행 시 이름과 저장 크기를 확인하는 상태 파일이므로 보관합니다. Drive에는 `rclone copy --immutable`로 복사합니다. `rcloneRemote`를 생략하면 Drive 복사는 건너뛰며 결과는 부분 완료입니다.

복원은 필요한 PDF를 그대로 열면 됩니다. 병합된 기록의 서명 원본은 `제공기록지/원본/`에 있습니다.

종료 코드: `0` 정상 완료, `2` 일부 문서 실패·Drive 실패/생략·제한으로 미조회 페이지가 남음, `1` 목록 조회 실패 또는 설정·초기화 오류, `3` 결과 보고 POST가 재시도까지 실패. `--limit` 실행은 `limited: true`로 보고합니다. 로그와 실패 여부는 `systemctl --user status eformsign-backup.service`에서 확인합니다. 예약 해제는 `systemctl --user disable --now eformsign-backup.timer`이며 보관 파일은 그대로 남습니다.
