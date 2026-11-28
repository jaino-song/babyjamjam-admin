# Lightsail cold standby 장애 전환 (초안, 실행 불가)

> **이 문서는 아직 실행할 수 있는 절차가 아닙니다 (2026-11-28, BJJ-598).**
> 코드와 문서를 읽고 쓴 초안이며 한 번도 실행하지 않았습니다. 3절의 차단 항목이 모두
> 닫히고 사용자가 순서를 승인하기 전에는 이 문서로 운영 전환을 하지 않습니다. 그 전에
> LightNode에 장애가 나면 이 문서를 따라가지 말고 3절의 항목을 하나씩 판단하면서
> 사용자와 함께 진행합니다. Lightsail 인스턴스도 그때까지 삭제하지 않습니다.

## 1. 지금 상태와 목표 상태

| 역할 | 호스트 | 지금 (2026-11-28) | 목표 |
|---|---|---|---|
| 운영 | LightNode | 운영 트래픽, 스케줄러, 문서 잡, 문자 발송을 모두 처리 | 같음 |
| 대기 | AWS Lightsail | 인스턴스 `babyjamjam-admin-server`가 **중지** 상태로 남아 있고, 스냅샷 `babyjamjam-admin-server-cold-standby-20261128`(80GB)이 있음. 삭제는 아직 안 함 | 스냅샷만 보관하고 인스턴스는 삭제 |
| 스테이징 | Google Cloud Run | 스케줄러는 꺼져 있지만 API가 운영 DB에 붙어 있음 | BJJ-599에서 전용 DB로 분리 |

- 백엔드 경로가 바뀐 `main` push는 검사와 DB 패치 대기가 끝난 뒤, `api.babyjamjam.com`이
  LightNode를 가리킬 때만 LightNode에 배포합니다. DNS가 Lightsail을 가리키는 동안에는
  `resolve backend deployment target` 잡이 **실패**하고 런타임 배포를 하지 않습니다.
- DNS 확인은 런타임 배포만 막습니다. `Database Patches` workflow는 별도로 돌기 때문에,
  장애 전환 중에도 조건에 맞는 `main` push는 운영 DB 패치를 적용할 수 있습니다. 장애 전환
  중에는 `main` merge를 멈춥니다.
- 스케줄러 실행권(`scheduler_lease`의 `background-owner` 행, ADR-010)은 예약 작업만 막고
  **API 요청은 막지 않습니다.** 한 호스트의 쓰기를 멈추려면 그 호스트의 API 컨테이너를
  내리거나 접근을 끊어야 합니다.

## 2. 누가 무엇을 할 수 있는가

| 작업 | 실행 주체 |
|---|---|
| 스냅샷에서 인스턴스 생성, 고정 IP 연결, 방화벽, 인스턴스 삭제 | AWS 계정 관리자(콘솔). 에이전트 IAM `agent-lightsail-operator`는 생성·삭제·네트워크 변경 권한이 없습니다 |
| 인스턴스 시작·중지·재부팅, 스냅샷 생성, 상태 조회 | 에이전트 IAM, 실행 직전 사용자 승인 |
| Lightsail 호스트의 `backend.env` 수정 | 호스트 관리자만(root 전용 파일). 에이전트는 값을 읽거나 쓰지 않습니다 |
| Lightsail 배포·상태·운영자 도구 갱신 | `Lightsail operations` workflow (`backend/deploy/lightsail/lightsail-cli.sh`) |
| DNS `api` A 레코드 변경 | Vercel DNS 관리 권한이 있는 사람 (`backend/deploy/fallback-server/VERCEL_DNS_FAILOVER.md`) |
| LightNode API 중지 | LightNode root 운영자(`backend/deploy/fallback-server/operator.sh stop`) 또는 LightNode 콘솔에서 전원 끄기 |

평소에 유지해야 하는 것:

| 항목 | 이유 |
|---|---|
| Lightsail 스냅샷 1개 이상 | 복원 원본 |
| Lightsail 고정 IP `babyjamjam-admin-server-static-ip` | GitHub secret `LIGHTSAIL_DNS_SHA256`이 이 IP의 해시입니다. IP가 바뀌면 배포 대상 결정이 "승인되지 않은 운영 경로"로 실패합니다 |
| GHCR 이미지 `ghcr.io/jaino-song/babyjamjam-admin-backend` 공개 pull | 호스트에는 registry 자격 증명이 없습니다 (`CI_AUTOMATION.md`) |
| `github-oidc-ssm` CloudFormation 스택, GitHub 변수 `AWS_PRODUCTION_*`, `LIGHTSAIL_SSM_TARGET_TAG` | `Lightsail operations` workflow가 사용합니다 |

## 3. 실행 전에 닫아야 하는 차단 항목

각 항목은 코드에서 확인한 사실과, 닫는 데 필요한 것을 적습니다. "결정"은 사용자가 정할 것,
"도구"는 코드 작업이 필요한 것입니다.

### B1. 순서가 승인된 것과 다릅니다 (결정 + 도구)

BJJ-598이 정한 순서는 "Lightsail에 현재 버전 배포 → 스케줄러·worker 켜기 → DNS 전환 →
LightNode 쓰기 중지"입니다. 지금 도구로는 이 순서를 지킬 수 없는 경우가 있습니다.

- 배포와 상태 확인은 공개 주소 `https://api.babyjamjam.com`의 health를 통과 조건으로
  봅니다(`ci-operator.sh`의 `status_environment`, 배포 뒤 확인). LightNode가 죽어 공개
  주소가 응답하지 않으면, DNS를 옮기기 전에는 Lightsail 배포가 통과하지 못합니다.
- 반대로 LightNode가 살아 있으면 공개 주소 확인에 LightNode가 응답합니다. 이 확인은
  응답한 서버가 Lightsail인지 구분하지 않으므로, 통과해도 Lightsail이 정상이라는 증거가
  아닙니다.

닫는 방법: 호스트 자신을 대상으로 확인하는 방식을 운영자 도구에 넣고(도구), 그 뒤에
순서를 다시 정합니다(결정).

### B2. 복원하거나 시작한 서버의 옛 API가 바로 운영 DB에 붙습니다 (도구 + 결정)

Compose의 `restart: unless-stopped` 때문에 인스턴스를 시작하거나 스냅샷에서 만들면
스냅샷 시점의 API(`8eefdbf2`, 2026-11-03 배포분), Valkey, Caddy가 자동으로 뜹니다. DNS와
무관하게 다음이 일어납니다.

| 경로 | 조건 |
|---|---|
| 스케줄러 실행권 획득 | 저장된 env의 `PRODUCTION_DEPLOYMENT_PROVIDER`가 `lightsail`이고 실행권이 비어 있으면 시작 직후 가져갑니다. 값이 없으면 가져가지 않습니다(`provider_not_configured`). 스냅샷 안의 값이 어느 쪽인지는 호스트에서 확인한 적이 없습니다 |
| 시작 시 템플릿 초기화 | 템플릿 테이블이 비어 있을 때만 씁니다. 템플릿이 이미 있으면 쓰지 않습니다 |
| API 요청 처리 | 이 서버에 도달한 인증된 요청은 실행권 없이도 쓰고 문자를 보낼 수 있습니다 |
| Migration | 컨테이너 시작만으로는 실행하지 않습니다. 배포할 때만 실행합니다 |

`backend.env`를 고쳐도 이미 떠 있는 컨테이너에는 반영되지 않습니다. 리허설 인스턴스에
DNS를 주지 않는 것만으로는 운영 DB 연결이 끊기지 않습니다.

닫는 방법: 부팅 뒤 API가 뜨기 전에 외부 접근과 DB 접근을 끊는 방법을 정하고(도구), 리허설을
운영 DB에 붙인 채 할지 격리된 대상으로 할지 정합니다(결정).

### B3. DNS 전환 전에는 등록 확인만 따로 할 방법이 없습니다 (도구)

`lightsail-cli.sh status production`은 공개 주소 health까지 확인하므로, LightNode가 내려가
있고 DNS가 아직 옮겨지지 않았으면 **정상 등록된 서버에서도 실패**합니다. 이 실패를 보고
Systems Manager 등록을 다시 하면 안 됩니다. 실패한 위치로 구분합니다.

- workflow가 명령을 보내기 전에 끝났다면 등록 문제입니다(`DeploymentTarget` 태그를 가진
  online 노드가 정확히 하나가 아님).
- `Systems Manager operation failed with status: ...`가 찍혔다면 노드는 등록돼 있고 명령도
  실행됐습니다. 호스트 쪽 확인이 실패한 것입니다.

지금 공개 주소 확인 없이 호스트에서 명령이 실행되는지 볼 수 있는 경로는
`operator-upgrade`뿐인데, 이것은 호스트의 운영자 도구를 바꾸는 작업이지 조회가 아닙니다.

닫는 방법: 등록만 확인하는 조회를 도구에 넣습니다.

### B4. 배포할 이미지가 없을 수 있습니다 (절차)

`lightsail-cli.sh deploy production`은 실행 시점의 `main` tip만 배포합니다. 다른 SHA는
고를 수 없고, 호스트는 tip이 아닌 SHA를 거부합니다.

- 백엔드 경로를 건드리지 않은 push(예: frontend만)가 `main` tip이면 그 SHA의 이미지가
  없습니다. 이미지 조회 단계에서 실패합니다.
- 승인을 기다리는 사이 `main`이 움직이면 호스트가 거부합니다.

DNS를 옮긴 뒤에 이 실패가 나면 옛 API가 운영 트래픽을 받는 채로 남습니다. DNS를 옮기기
전에 `main` tip SHA의 이미지 digest가 조회되는지 확인하고, 전환이 끝날 때까지 `main`
merge를 멈춥니다. tip에 이미지가 없을 때 이미지를 만드는 승인된 방법은 아직 없습니다.

### B5. 옛 운영자 도구와 DB 구조 변경 (절차 + 결정)

스냅샷 안의 운영자 도구와 "직전 이미지" 기록은 2026-11-03 시점입니다. 그 뒤 저장소에는
migration `20261126010000_baby_case_keys`가 추가됐습니다. 운영 DB에 이 변경이 어느 단계까지
적용됐는지는 전환 시점에 확인해야 합니다.

- 이 migration이 들어간 이미지를 한 호스트에 처음 배포할 때는 `CI_AUTOMATION.md`의
  "Release and recovery contract" 순서(운영자 도구 갱신 → DB 단계 확인 → 배포)를 따라야
  합니다. Lightsail 호스트는 이 순서를 거친 적이 없습니다.
- 운영자 도구 갱신은 `lightsail-cli.sh operator-upgrade`입니다. `main` tip에서만 설치하고
  운영 승인이 필요합니다.
- 자동 롤백이 돌아갈 "직전 이미지"는 11월 3일 이미지입니다. 이 이미지가 지금 DB 구조와
  맞는지 확인되지 않았습니다. `CI_AUTOMATION.md`는 단계 적용 뒤에는 case 단위 키를 지원하는
  이미지로만 복구하라고 적습니다.
- 이미지 받기나 migration에서 실패하면 롤백 없이 끝나고 옛 API가 그대로 남습니다. 활성화나
  확인에서 실패하면 직전 이미지로 롤백을 시도하는데, 이것도 실패할 수 있고 적용된 DB
  변경은 되돌려지지 않습니다.

닫는 방법: DB와 맞는 복구용 이미지를 정하고, 각 실패 지점에서 무엇을 할지 정합니다.

### B6. 실행권 공백과 중단 시간의 한도가 없습니다 (결정)

90초는 LightNode가 비정상 종료했을 때 실행권이 만료되는 시간일 뿐입니다. LightNode를
내린 뒤 Lightsail에 실행 주체가 설정된 버전이 배포될 때까지는 예약 작업을 도는 서버가
없고, 그 길이는 복원·승인·배포 시간에 달려 있습니다. 허용할 중단 시간과, 넘으면 무엇을
할지(예: LightNode 복구로 돌아가기)가 정해져 있지 않습니다.

### B7. LightNode로 되돌리는 절차가 없습니다 (결정 + 절차)

이 문서는 되돌리는 순서를 정하지 않습니다. 기존 절차를 방향만 바꿔 쓰면 안 됩니다.

- DNS를 옮기는 동안 두 서버가 모두 요청을 받아 둘 다 운영 DB에 쓸 수 있습니다. 실행권은
  예약 작업만 막습니다.
- LightNode의 일반 `deploy`는 스케줄러와 문자 발송이 꺼진 passive로 뜹니다. 운영으로
  올리려면 별도 승인 파일이 필요한 `temporary-active`를 거쳐야 합니다
  (`backend/deploy/fallback-server/README.md`).

되돌리기는 별도로 승인받은 절차가 생긴 뒤에만 합니다.

## 4. 제안 순서 (초안)

3절이 닫히기 전에는 실행하지 않습니다. 각 단계는 운영 서버·DB·DNS를 바꾸므로 실행 직전에
사용자 승인을 받습니다. 괄호는 그 단계가 걸려 있는 차단 항목입니다.

1. **전환 결정.** LightNode가 일시적 장애가 아닌지 확인합니다. `main` merge를 멈춥니다.
2. **이미지 확인 (B4).** `main` tip SHA의 이미지 digest가 조회되는지 확인합니다.
3. **LightNode 쓰기 차단 (B1, B6).** 접속되면 root 운영자의 `operator.sh stop`, 안 되면
   콘솔에서 전원을 끕니다. 정상 종료면 실행권을 즉시 반납하고, 비정상 종료면 마지막
   갱신에서 최대 90초 뒤 만료됩니다.
4. **인스턴스 준비 (B2).** 원본이 중지 상태로 남아 있으면 **시작**합니다(에이전트 IAM).
   삭제한 뒤라면 관리자 콘솔에서 가장 최근 스냅샷으로 만듭니다: 리전 `ap-northeast-2`,
   번들 `medium_3_0`, 고정 IP 연결, 방화벽 80·443 열기, 22는 작업 장비의 `/32`만.
5. **운영자 도구 갱신 (B3, B5).** `lightsail-cli.sh operator-upgrade`. 성공하면 노드가
   등록돼 있고 명령이 실행된다는 것도 함께 확인됩니다.
6. **실행 주체 설정.** 호스트 관리자가
   `/opt/babyjamjam/environments/production/backend.env`에 아래 네 키가 있는지 확인합니다.
   고정 설정값이며 비밀이 아닙니다. 컨테이너를 다시 만드는 배포에서 반영됩니다.

   ```
   SCHEDULERS_ENABLED=true
   SCHEDULER_LEASE_MODE=required
   SCHEDULER_LEASE_HOLDER_ID=lightsail
   PRODUCTION_DEPLOYMENT_PROVIDER=lightsail
   ```

   `SCHEDULER_LEASE_MODE`를 `off`로 두지 않습니다. `off`이고 실행 주체가 일치하면 DB 실행권
   확인 없이 예약 작업이 돕니다.
7. **DNS 전환 (B1).** `VERCEL_DNS_FAILOVER.md` 절차로 `api` A 레코드를 Lightsail 고정
   IP로 바꿉니다(TTL 60). 이 순간부터 배포가 끝날 때까지 옛 API가 운영 트래픽을 받습니다.
   Caddy 인증서가 만료됐으면 재발급이 끝날 때까지 HTTPS가 실패합니다.
8. **배포 (B4, B5).** `lightsail-cli.sh deploy production`.
9. **확인.** `/health/ready`가 200이고 `/health/lease`가 아래와 같아야 합니다. 그 뒤 로그인,
   고객 조회, 제공기록지 링크 열기, 테스트 번호로 문자 1건을 확인합니다.

   ```json
   {"mode":"required","holderId":"lightsail","held":true,"provider":"lightsail","eligible":true,"eligibilityReason":"provider_match"}
   ```

10. **전환 뒤.** LightNode는 꺼 둡니다. 전환 중의 운영 배포는 8번 명령으로만 합니다.

## 5. 리허설로 확인할 것

리허설은 B2가 닫힌 뒤에 사용자 승인 하에 합니다.

| # | 확인할 것 | 지금 상태 |
|---|---|---|
| 1 | 복원한 인스턴스가 Systems Manager에 online 노드 하나로 잡히는가 | 미확인 |
| 2 | 복원한 인스턴스에서 Caddy edge와 외부 volume·network가 그대로 뜨는가 | 미확인. 새로 띄우는 절차는 문서에 없습니다 |
| 3 | 운영 hostname으로 옮겼을 때 TLS 인증서가 유효한가, 재발급에 얼마나 걸리는가 | 미확인. DNS를 옮기지 않는 리허설로는 확인할 수 없습니다 |
| 4 | Lightsail 고정 IP가 Aligo 발신 IP로 등록돼 있는가 | 미확인 |
| 5 | 운영 DB(Supabase)에 접속 IP 제한이 있는가 | 미확인 |
| 6 | 인스턴스 준비부터 확인 통과까지 걸리는 실제 시간 | 미측정 |
| 7 | GitHub `production` 환경에 승인자가 설정돼 있는가 | 2026-11-28에 승인 잡이 대기 없이 통과했습니다. BJJ-601에서 설정합니다 |
| 8 | Sentry DB 경로 전환 스택(`*-db-failover`)이 배포돼 있는가 | 미확인 |
| 9 | 8번이 배포돼 있다면 `EnableFailover`가 켜져 있는가 | 미확인. 기본값은 꺼짐이고, 꺼져 있으면 worker가 노드를 조회하지 않습니다 |
| 10 | 8번의 알람에 알림 대상(topic)이 연결돼 있는가 | 미확인. 연결돼 있지 않으면 알람이 울려도 알림이 가지 않습니다 |

## 6. Cold standby로 내리는 진행 상황

1. 인스턴스 중지. **완료: 2026-11-28 13:23 KST.** 되돌리려면 시작하면 됩니다(B2 참고:
   시작하면 옛 API가 운영 DB에 붙습니다).
2. 수동 스냅샷. **완료: 2026-11-28 13:34 KST**,
   `babyjamjam-admin-server-cold-standby-20261128`(80GB, `available`).
3. 3절의 차단 항목을 닫고 리허설. **미실행.**
4. 원본 인스턴스 삭제(관리자 콘솔, 승인 필요). 고정 IP는 삭제하지 않습니다. **미실행.**

중지된 인스턴스도 요금이 나갑니다. 비용이 줄어드는 시점은 4번입니다.
