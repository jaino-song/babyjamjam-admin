# Lightsail cold standby 장애 전환 (초안, 실행 불가)

> **이 문서는 아직 실행할 수 있는 절차가 아닙니다 (2026-11-28, BJJ-598 · BJJ-605).**
> 코드와 문서를 읽고 쓴 초안이며 한 번도 실행하지 않았습니다. 3절의 차단 항목이 모두
> 닫히고 사용자가 순서를 승인하기 전에는 이 문서로 운영 전환을 하지 않습니다. 그 전에
> LightNode에 장애가 나면 이 문서를 따라가지 말고 3절의 항목을 하나씩 판단하면서
> 사용자와 함께 진행합니다. Lightsail 인스턴스도 그때까지 삭제하지 않습니다.
>
> **중지된 Lightsail 인스턴스를 시작하지 않습니다.** 지금의 인스턴스와 스냅샷은 API가 켜진
> 채로 저장돼 있어서, 시작하는 순간 옛 API가 운영 DB에 붙습니다(B2). 이를 막는 `standby`
> 명령은 저장소에 들어왔지만 호스트에는 아직 적용되지 않았습니다. 6절의 "통제된 첫 부팅"을
> 사용자가 승인한 경우에만 시작합니다.

## 1. 지금 상태와 목표 상태

| 역할 | 호스트 | 지금 (2026-11-28) | 목표 |
|---|---|---|---|
| 운영 | LightNode | 운영 트래픽, 스케줄러, 문서 잡, 문자 발송을 모두 처리 | 같음 |
| 대기 | AWS Lightsail | 인스턴스 `babyjamjam-admin-server`가 **중지** 상태로 남아 있고, 스냅샷 `babyjamjam-admin-server-cold-standby-20261128`(80GB)이 있음. 삭제는 아직 안 함 | 스냅샷만 보관하고 인스턴스는 삭제 |
| 스테이징 | Google Cloud Run | 스케줄러는 꺼져 있지만 API가 운영 DB에 붙어 있음 | BJJ-599에서 전용 DB로 분리 |

- 백엔드 경로가 바뀐 `main` push는 검사와 DB 패치 대기 게이트가 통과한 뒤,
  `api.babyjamjam.com`이 LightNode를 가리킬 때만 LightNode에 배포합니다. 대기 게이트는 그
  커밋의 `Database Patches` 실행이 조회되면 각 실행이 끝나고 그 안의 `apply production
  database patches` 잡이 성공하기를 기다립니다(실행이 성공으로 끝나도 그 잡이 건너뛰어졌으면
  실패합니다). 조회되지 않으면 변경
  파일로 판단합니다: `backend/prisma/`나 패치 workflow 파일이 바뀌었으면 실행이 나타나기를
  기다리다 없으면 실패하고, 바뀌지 않았으면 바로 통과합니다. 게이트 통과가 항상 패치
  성공을 뜻하지는 않습니다. 리플레이 스크립트만 바뀐 커밋에서 실행이 아직 조회되지
  않았거나, 변경 파일 비교가 실패한 채 실행이 나타나지 않으면 패치 확인 없이 통과합니다. DNS가 Lightsail을 가리키는 동안에는
  `resolve backend deployment target` 잡이 **실패**하고 런타임 배포를 하지 않습니다.
- DNS 확인은 런타임 배포만 막습니다. `Database Patches` workflow는 별도로 돕니다. 그래서
  장애 전환 중에는 두 가지를 따로 통제합니다.
  - **이미지 SHA 고정:** `main` merge를 멈춥니다(B4).
  - **운영 DB 패치 통제:** 조건에 맞는 `main` push뿐 아니라 `preview` push(preview가 운영
    DB를 같이 쓰는 동안)와 수동 `production` 실행도 같은 운영 DB를 패치할 수 있습니다.
    `preview` merge와 수동 실행도 멈추고, 끝나지 않은 패치 실행이 하나도 없는지 확인합니다.
    실행 중인 것뿐 아니라 큐에 있거나 승인 대기 중인 것도 포함합니다. 패치 실행은 한 번에
    하나씩 돌기 때문에 큐에 있던 실행이 전환 도중에 시작할 수 있습니다.
- 스케줄러 실행권(`scheduler_lease`의 `background-owner` 행, ADR-010)은 예약 작업만 막고
  **API 요청은 막지 않습니다.** 한 호스트의 쓰기를 멈추려면 그 호스트의 API 컨테이너를
  내리거나 접근을 끊어야 합니다.

## 2. 누가 무엇을 할 수 있는가

| 작업 | 실행 주체 |
|---|---|
| 스냅샷에서 인스턴스 생성, 고정 IP 연결, 방화벽, 인스턴스 삭제 | AWS 계정 관리자(콘솔). 에이전트 IAM `agent-lightsail-operator`는 생성·삭제·네트워크 변경 권한이 없습니다 |
| 인스턴스 시작·중지·재부팅, 스냅샷 생성, 상태 조회 | 에이전트 IAM, 실행 직전 사용자 승인 |
| Lightsail 호스트의 `backend.env` 수정 | 호스트 관리자만(root 전용 파일). 에이전트는 값을 읽거나 쓰지 않습니다 |
| Lightsail 배포·상태·운영자 도구 갱신, 등록 조회, 대기 전환 | `Lightsail operations` workflow (`backend/deploy/lightsail/lightsail-cli.sh`). 명령은 아래 표 |
| `github-oidc-ssm` CloudFormation 스택 갱신, GitHub 변수 설정 | AWS 계정 관리자와 저장소 관리자 |
| DNS `api` A 레코드 변경 | Vercel DNS 관리 권한이 있는 사람 (`backend/deploy/fallback-server/VERCEL_DNS_FAILOVER.md`) |
| LightNode API 중지 | LightNode root 운영자(`backend/deploy/fallback-server/operator.sh stop`) 또는 LightNode 콘솔에서 전원 끄기 |

평소에 유지해야 하는 것:

| 항목 | 이유 |
|---|---|
| Lightsail 스냅샷 1개 이상 | 복원 원본 |
| Lightsail 고정 IP `babyjamjam-admin-server-static-ip` | GitHub secret `LIGHTSAIL_DNS_SHA256`이 이 IP의 해시입니다. IP가 바뀌면 배포 대상 결정이 "승인되지 않은 운영 경로"로 실패합니다 |
| GHCR 이미지 `ghcr.io/jaino-song/babyjamjam-admin-backend` 공개 pull | 호스트에는 registry 자격 증명이 없습니다 (`CI_AUTOMATION.md`) |
| `github-oidc-ssm` CloudFormation 스택, GitHub 변수 `AWS_PRODUCTION_*`, `AWS_HOST_STANDBY_DOCUMENT_NAME`, `LIGHTSAIL_SSM_TARGET_TAG` | `Lightsail operations` workflow가 사용합니다. 변수가 비어 있으면 workflow가 그 변수 이름을 찍고 실패합니다 |

`lightsail-cli.sh` 명령 (운영 환경은 모두 GitHub `production` 승인을 거칩니다):

| 명령 | 하는 일 | 호스트에 명령을 보내는가 |
|---|---|---|
| `node-status production` | Systems Manager에 노드가 정확히 하나 등록돼 있고 Online인지 조회 | 아니오 |
| `standby` | 호스트의 운영·preview API 컨테이너를 멈추고 멈춘 채로 둠. 운영 DNS가 LightNode를 가리킬 때만 실행됨 | 예 |
| `status production --self` | 공개 주소를 쓰지 않고 이 호스트의 컨테이너 상태, 이미지 일치, 내부 readiness를 확인 | 예 |
| `deploy production --self` | `main` tip 이미지를 배포하고 위와 같은 방식으로 확인 | 예 |
| `status production`, `deploy production` | 위 확인에 더해 공개 주소 `https://api.babyjamjam.com`의 health까지 확인. DNS가 이 호스트를 가리킨 뒤에만 의미가 있음 | 예 |
| `operator-upgrade` | 호스트의 운영자 도구를 `main` tip 버전으로 교체 | 예 |

`standby`, `--self`, `node-status`는 BJJ-605에서 추가됐습니다. 앞의 둘은 CloudFormation 스택을
갱신하고 GitHub 변수 세 개(`AWS_HOST_STANDBY_DOCUMENT_NAME`,
`AWS_PRODUCTION_SELF_STATUS_DOCUMENT_NAME`, `AWS_PRODUCTION_SELF_DEPLOY_DOCUMENT_NAME`)를 설정하고
호스트의 운영자 도구를 갱신한 뒤에야 동작합니다(6절).

## 3. 실행 전에 닫아야 하는 차단 항목

각 항목은 코드에서 확인한 사실과, 닫는 데 필요한 것을 적습니다. "결정"은 사용자가 정할 것,
"도구"는 코드 작업이 필요한 것입니다.

### B1. 승인된 순서를 지킬 도구는 생겼고, 호스트 적용과 순서 승인이 남았습니다 (결정)

BJJ-598이 정한 순서는 "Lightsail에 현재 버전 배포 → 스케줄러·worker 켜기 → DNS 전환 →
LightNode 쓰기 중지"입니다. 기존 `status`와 `deploy`는 공개 주소
`https://api.babyjamjam.com`의 health를 통과 조건으로 보기 때문에 이 순서를 지킬 수
없었습니다. LightNode가 죽어 있으면 DNS를 옮기기 전에는 통과하지 못하고, 살아 있으면
LightNode의 응답으로 통과했습니다.

BJJ-605에서 `--self`를 추가했습니다.

- `--self`는 공개 주소를 쓰지 않습니다. 확인하는 것은 이 호스트의 API 컨테이너가 하나만 떠
  있고 `healthy`인지, 재시작한 적이 없는지, 스케줄러 설정과 실행 주체 설정이 맞는지, 기록된
  이미지와 실제 이미지가 같은지, 컨테이너 안에서 `/health/ready`가 통과하는지입니다.
- `--self`가 확인하지 않는 것: 공개 주소로 들어온 요청이 이 호스트에 도달하는지, 그리고
  실행권을 실제로 쥐고 있는지. 앞의 것은 DNS를 옮긴 뒤 `status production`으로 확인합니다.
- `--self` 출력의 `edge_route`와 `edge_tls`는 이 호스트의 Caddy에 `127.0.0.1`로 직접 물어본
  결과입니다. `edge_route=ok`는 Caddy가 운영 hostname 요청을 이 API로 넘긴다는 뜻이고,
  `edge_tls=ok`는 그때 인증서가 유효했다는 뜻입니다. 둘 다 통과 조건이 아니고 workflow에
  경고로만 표시됩니다. 트래픽을 받지 않던 대기 서버는 DNS가 옮겨질 때까지 인증서가 만료된
  채일 수 있어서입니다. `edge_route=failed`는 "Caddy가 떠 있지 않다"와 "이 이름의 인증서가
  아예 없다"를 구분하지 못합니다.

남은 것: 이 도구를 호스트에 적용하고(6절), 4절의 순서를 사용자가 승인합니다(결정).

### B2. 복원하거나 시작한 서버의 옛 API가 바로 운영 DB에 붙습니다 (적용 + 결정)

Compose의 `restart: unless-stopped` 때문에 인스턴스를 시작하거나 스냅샷에서 만들면
스냅샷 시점의 API(`8eefdbf2`, 2026-11-03 배포분), Valkey, Caddy가 자동으로 뜹니다. DNS와
무관하게 다음이 일어납니다.

| 경로 | 조건 |
|---|---|
| 스케줄러 실행권 획득 | 저장된 env가 `SCHEDULERS_ENABLED=true`, `SCHEDULER_LEASE_MODE=required`이고 `PRODUCTION_DEPLOYMENT_PROVIDER`와 `SCHEDULER_LEASE_HOLDER_ID`가 둘 다 `lightsail`이면 시작 직후 획득을 시도합니다. 운영 모드에서는 `SCHEDULERS_ENABLED`와 `SCHEDULER_LEASE_MODE`가 아예 없어도 각각 켜짐과 `required`로 해석되므로, 이 두 키가 없다는 것은 안전 장치가 아닙니다. 시도는 실행권이 비어 있거나 만료됐을 때 성공합니다. holder ID가 다른 호스트(`lightnode`)가 쥐고 있으면 만료될 때까지(마지막 갱신에서 90초) 실패하고 주기적으로 다시 시도합니다. holder ID가 같은(`lightsail`) 다른 인스턴스가 쥐고 있으면 70초 동안 갱신이 없을 때 만료 전에 넘겨받습니다. 원본과 리허설 인스턴스가 함께 떠 있으면 이 경우에 해당합니다. `PRODUCTION_DEPLOYMENT_PROVIDER`가 없으면 시도하지 않습니다(`provider_not_configured`). 2026-11-28 상태 조회에서 앞의 세 값은 이 조건과 같았고, `PRODUCTION_DEPLOYMENT_PROVIDER` 값은 호스트에서 확인한 적이 없습니다 |
| 시작 시 템플릿 초기화 | 템플릿 테이블이 비어 있을 때만 씁니다. 템플릿이 이미 있으면 쓰지 않습니다 |
| API 요청 처리 | 이 서버에 도달한 인증된 요청은 실행권 없이도 쓰고 문자를 보낼 수 있습니다 |
| Migration | 컨테이너 시작만으로는 실행하지 않습니다. 배포할 때만 실행합니다 |

`backend.env`를 고쳐도 이미 떠 있는 컨테이너에는 반영되지 않습니다. 리허설 인스턴스에
DNS를 주지 않는 것만으로는 운영 DB 연결이 끊기지 않습니다. 이 항목은 인스턴스를 시작하는
모든 경우에 적용됩니다: 장애 전환, 리허설, 그리고 6절의 중지를 되돌리는 경우.

BJJ-605에서 `standby` 명령을 추가했습니다. 호스트의 API 컨테이너를 `docker stop`으로
멈춥니다. `unless-stopped` 정책은 이렇게 멈춘 컨테이너를 Docker가 다시 시작되거나 서버가
재부팅돼도 띄우지 않습니다(Docker 문서 기준이며, 이 호스트에서 확인한 적은 없습니다). 그
상태에서 스냅샷을 뜨면 그 스냅샷으로 만든 서버는 API가 꺼진 채로 부팅됩니다. 멈춘 API를
다시 띄우는 것은 `deploy`뿐이고, 그때는 `main` tip 이미지가 뜹니다.

아직 닫히지 않은 부분:

- **지금의 인스턴스와 스냅샷에는 적용되지 않았습니다.** 한 번은 켜서 `standby`를 실행하고
  새 스냅샷을 떠야 합니다(6절의 통제된 첫 부팅). 그 몇 분 동안은 위 표가 그대로 적용됩니다.
- **DB 경로 전환(`db-reconcile`)이 대기 상태의 API를 다시 띄울 수 있습니다.** Sentry DB 경로
  전환 스택(`*-db-failover`)이 배포돼 있고 `EnableFailover`가 켜져 있으면, worker가 호스트에
  경로 확인 명령을 보내고 경로를 바꿀 때 API 컨테이너를 다시 만듭니다. 인스턴스가 꺼져
  있으면 명령이 도달하지 않으므로 해당하지 않습니다. **Lightsail이 대기 상태인 동안에는
  `EnableFailover`를 꺼 둡니다.** 스택의 배포 여부와 이 값은 아직 확인하지 못했습니다(5절).
  호스트 쪽에서 막는 것은 worker 변경이 함께 필요해 BJJ-605에 넣지 않았습니다.
- `standby`는 운영과 preview 두 환경을 한 번에 멈추지만 workflow의 동시 실행 제한은 운영
  환경 기준입니다. `preview` 브랜치에서 Lightsail preview 작업을 동시에 돌리지 않습니다.
- 리허설을 운영 DB에 붙인 채 할지 격리된 대상으로 할지는 사용자가 정합니다(결정).

### B3. 등록만 확인하는 조회가 생겼습니다 (닫힘, 실제 호스트 확인은 리허설에서)

`lightsail-cli.sh node-status production`은 `DeploymentTarget` 태그가 붙은 노드의 수와
Online 수만 조회하고 호스트에 명령을 보내지 않습니다. 노드가 정확히 하나이고 Online일 때만
성공합니다. 스택 갱신 없이 지금 권한으로 동작합니다.

workflow가 실패했을 때 원인은 넷으로 나뉩니다. 등록 문제인지는 이제 `node-status`로 따로
확인할 수 있고, 뒤의 셋은 재등록으로 해결되지 않습니다.

| 원인 | 근거 |
|---|---|
| 등록 문제 | `node-status`가 실패. 다른 작업도 명령을 보내기 전에 `managed_nodes=`와 `online_nodes=`를 찍고 같은 이유로 끝납니다 |
| 명령 전송 실패 | 노드는 등록돼 있는데 전송 권한이나 문서 문제로 명령을 보내지 못함. GitHub 변수가 비어 있으면 그 변수 이름이 찍힙니다 |
| 명령 미전달 | 전송은 됐지만 호스트에 도달하지 않거나 시간 초과. `Systems Manager operation failed with status: ...`가 찍히는 경우도 있고, 호출 기록이 끝까지 나타나지 않으면 아무 진단 메시지 없이 끝나는 경우도 있습니다 |
| 호스트 확인 실패 | 호스트에서 명령이 실행됐고 그 안의 확인이 실패. 호스트 출력은 확인보다 먼저 찍힙니다. DNS 전환 전에는 `--self` 없는 `status`가 여기서 실패하는 것이 정상입니다 |

### B4. 배포할 이미지가 없을 수 있습니다 (절차)

`lightsail-cli.sh deploy production`은 실행 시점의 `main` tip만 배포합니다. 다른 SHA는
고를 수 없고, 호스트는 tip이 아닌 SHA를 거부합니다.

- 백엔드 경로를 건드리지 않은 push(예: frontend만)가 `main` tip이면 그 SHA의 이미지가
  없습니다. 이미지 조회 단계에서 실패합니다.
- 승인을 기다리는 사이 `main`이 움직이면 호스트가 거부합니다.

DNS를 옮긴 뒤에 이 실패가 나면 옛 API가 운영 트래픽을 받는 채로 남습니다. DNS를 옮기기
전에 `main` tip SHA의 이미지 digest가 조회되는지 확인하고, 전환이 끝날 때까지 `main`
merge를 멈춥니다. tip에 이미지가 없을 때 이미지를 만드는 승인된 방법은 아직 없습니다.

사용자 결정(2026-11-28): 이 문제는 BJJ-601에서 닫습니다. BJJ-601의 구조는 `main` merge마다
이미지를 한 번 빌드하므로 tip에 이미지가 없는 경우가 없어집니다. 그 전까지는 위 확인 절차만
있습니다.

### B5. 옛 운영자 도구와 DB 구조 변경 (절차 + 결정)

스냅샷 안의 운영자 도구와 "직전 이미지" 기록은 2026-11-03 시점입니다. 그 뒤 저장소에는
migration `20261126010000_baby_case_keys`가 추가됐습니다. 운영 DB에 이 변경이 어느 단계까지
적용됐는지는 전환 시점에 확인해야 합니다.

- 이 migration이 들어간 이미지를 한 호스트에 처음 배포할 때는 `CI_AUTOMATION.md`의
  "Release and recovery contract" 순서(운영자 도구 갱신 → DB 단계 확인 → 배포)를 따라야
  합니다. Lightsail 호스트는 이 순서를 거친 적이 없습니다.
- 운영자 도구 갱신은 `lightsail-cli.sh operator-upgrade`입니다. `main` tip에서만 설치하고
  운영 승인이 필요합니다.
- 호스트에 기록된 "직전 이미지"는 11월 3일 이미지입니다. 이 이미지가 지금 DB 구조와
  맞는지 확인되지 않았습니다. `CI_AUTOMATION.md`는 단계 적용 뒤에는 case 단위 키를 지원하는
  이미지로만 복구하라고 적습니다.
- 배포가 실패했을 때의 동작은 배포를 시작할 때 API가 떠 있었는지에 따라 다릅니다(BJJ-605).
  - **API가 꺼져 있었으면(대기 상태에서 시작)** 직전 이미지를 띄우지 않고 다시 대기 상태로
    돌아갑니다. API는 꺼진 채로 남고 기록된 이미지 정보는 배포 전 값으로 돌아갑니다.
  - **API가 떠 있었으면** 직전 이미지로 롤백을 시도합니다. 이 롤백도 실패할 수 있습니다.
  - 이미지 받기나 migration에서 실패하면 어느 경우든 컨테이너를 건드리지 않고 끝납니다.
    꺼져 있던 API는 꺼진 채로, 떠 있던 API는 그대로 남습니다.
  - 어느 경우든 이미 적용된 DB 변경은 되돌려지지 않습니다.

닫는 방법: Lightsail이 운영을 맡은 뒤의 배포가 실패했을 때 돌아갈, DB와 맞는 복구용
이미지를 정하고, 각 실패 지점에서 무엇을 할지 정합니다.

### B6. 실행권 공백과 중단 시간의 한도가 없습니다 (결정)

90초는 LightNode가 비정상 종료했을 때 실행권이 만료되는 시간일 뿐입니다. LightNode가 죽은
시점부터 Lightsail에 실행 주체가 설정된 버전이 배포될 때까지는 예약 작업을 도는 서버가
없고, DNS가 옮겨질 때까지는 요청을 받는 서버도 없습니다. 그 길이는 복원·승인·배포 시간에
달려 있습니다. 허용할 중단 시간과, 넘으면 무엇을 할지(예: LightNode 복구로 돌아가기)가
정해져 있지 않습니다.

### B7. LightNode로 되돌리는 절차가 없습니다 (결정 + 절차)

이 문서는 되돌리는 순서를 정하지 않습니다. 기존 절차를 방향만 바꿔 쓰면 안 됩니다.

- DNS를 옮기는 동안 두 서버가 모두 요청을 받아 둘 다 운영 DB에 쓸 수 있습니다. 실행권은
  예약 작업만 막습니다.
- LightNode의 일반 `deploy`는 스케줄러와 문자 발송이 꺼진 passive로 뜹니다. 운영으로
  올리려면 별도 승인 파일이 필요한 `temporary-active`를 거쳐야 합니다
  (`backend/deploy/fallback-server/README.md`).

- Lightsail을 다시 대기 상태로 내리는 도구는 `standby`입니다. 운영 DNS가 LightNode를 가리킬
  때만 실행되므로, DNS를 LightNode로 되돌린 뒤에 씁니다. 그 사이 두 서버가 요청을 함께 받는
  구간과 실행권이 넘어가는 시점은 절차로 정해야 합니다.

되돌리기는 별도로 승인받은 절차가 생긴 뒤에만 합니다.

## 4. 제안 순서 (초안)

3절이 닫히기 전에는 실행하지 않습니다. 각 단계는 운영 서버·DB·DNS를 바꾸므로 실행 직전에
사용자 승인을 받습니다. 괄호는 그 단계가 걸려 있는 차단 항목입니다. 순서는 BJJ-598이 정한
"배포 → 스케줄러 → DNS → LightNode 쓰기 중지"를 따르며, 6절의 준비(스택 갱신, 대기 상태
스냅샷)가 끝나 있다는 것을 전제로 합니다.

1. **전환 결정 (B6).** LightNode가 일시적 장애가 아닌지 확인합니다. `main` merge를 멈추고,
   운영 DB 패치(`preview` merge, 수동 실행, 끝나지 않은 모든 실행)를 1절대로 통제합니다.
2. **이미지 확인 (B4).** `main` tip SHA의 이미지 digest가 조회되는지 확인합니다.
3. **인스턴스 준비 (B2).** 원본이 중지 상태로 남아 있으면 **시작**합니다(에이전트 IAM).
   삭제한 뒤라면 관리자 콘솔에서 대기 상태로 뜬 가장 최근 스냅샷으로 만듭니다: 리전
   `ap-northeast-2`, 번들 `medium_3_0`, 고정 IP 연결, 방화벽 80·443 열기, 22는 작업 장비의
   `/32`만. 대기 상태 스냅샷이면 API는 꺼진 채로 부팅됩니다.
4. **등록 확인 (B3).** `lightsail-cli.sh node-status production`.
5. **운영자 도구 갱신 (B5).** `lightsail-cli.sh operator-upgrade`. 스냅샷 안의 도구가 `main`과
   같으면 바뀌는 것이 없습니다.
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
7. **배포와 스케줄러 (B1, B5).** `lightsail-cli.sh deploy production --self`. `main` tip
   이미지로 API가 뜨고, 통과 여부는 이 호스트 안에서 확인합니다. 실패하면 API는 다시 꺼진
   상태로 돌아갑니다. 통과하면 출력의 `edge_route`와 `edge_tls`를 봅니다. `edge_route`가
   `ok`가 아니면 DNS를 옮기지 않고 멈춥니다.
   이 시점부터 Lightsail API가 실행권을 요청합니다. LightNode가 실행권을 쥐고 갱신하는
   동안에는 얻지 못하고, LightNode가 죽어 있으면 마지막 갱신에서 90초 뒤에 얻습니다.
   LightNode가 살아 있더라도 재시작 등으로 실행권을 반납하면 그때 Lightsail로 넘어오고
   LightNode는 되찾지 못합니다. 실행권을 쥔 서버는 어느 순간에도 하나입니다.
8. **DNS 전환 (B1).** `VERCEL_DNS_FAILOVER.md` 절차로 `api` A 레코드를 Lightsail 고정
   IP로 바꿉니다(TTL 60). LightNode가 살아 있으면 DNS가 퍼지는 동안 두 서버가 함께 요청을
   받고 둘 다 운영 DB에 씁니다. 7단계에서 `edge_tls`가 `ok`가 아니었다면 Caddy가 인증서를
   새로 받을 때까지 HTTPS가 실패합니다.
9. **공개 주소 확인.** `lightsail-cli.sh status production`(`--self` 없음). 공개 주소 health와
   인증서까지 통과해야 합니다. 이 확인은 응답한 서버가 Lightsail인지 구분하지 않으므로, 7단계가
   통과한 뒤에만 의미가 있습니다.
10. **LightNode 쓰기 중지.** 접속되면 root 운영자의 `operator.sh stop`, 안 되면 콘솔에서
    전원을 끕니다. 그 뒤 `/health/lease`가 아래와 같아야 합니다. 정상 종료에서도 DB 응답이
    늦거나 실패하면 실행권이 반납되지 않을 수 있고, 그때는 마지막 갱신에서 90초 뒤에
    Lightsail이 얻습니다.

    ```json
    {"mode":"required","holderId":"lightsail","held":true,"provider":"lightsail","eligible":true,"eligibilityReason":"provider_match"}
    ```

11. **확인.** `/health/ready`가 200인지 보고, 로그인, 고객 조회, 제공기록지 링크 열기, 테스트
    번호로 문자 1건을 확인합니다.
12. **전환 뒤.** LightNode는 꺼 둡니다. 전환 중의 운영 배포는 `lightsail-cli.sh deploy
    production`으로만 합니다. 이때부터의 배포 실패는 직전 이미지로 롤백합니다(B5).

## 5. 리허설로 확인할 것

리허설은 6절의 대기 상태 스냅샷이 만들어진 뒤에 사용자 승인 하에 합니다.

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
| 11 | `standby` 뒤 재부팅하거나 스냅샷에서 복원했을 때 API가 꺼진 채로 있는가 | 미확인. Docker 문서 기준으로는 그렇습니다 |
| 12 | 호스트에서 `127.0.0.1`의 443으로 Caddy에 닿는가(`edge_route`, `edge_tls`가 값을 내는가) | 미확인. Docker 네트워크 설정에 따라 닿지 않을 수 있습니다 |
| 13 | 호스트 `backend.env`의 `PRODUCTION_DEPLOYMENT_PROVIDER` 값 | 미확인 |
| 14 | API 컨테이너가 일시정지나 재시작 반복 상태일 때 `standby`가 멈추는가 | 미확인. 테스트는 Docker를 흉내 낸 대역으로만 돌렸습니다. `standby`는 멈춘 뒤 다시 조회해서 남아 있으면 실패로 끝납니다 |

## 6. Cold standby로 내리는 진행 상황

1. 인스턴스 중지. **완료: 2026-11-28 13:23 KST.**
2. 수동 스냅샷. **완료: 2026-11-28 13:34 KST**,
   `babyjamjam-admin-server-cold-standby-20261128`(80GB, `available`). 이 스냅샷은 API가 켜진
   채로 저장된 것입니다.
3. 장애 전환 도구(BJJ-605: `node-status`, `standby`, `--self`). **저장소 반영 중.** 호스트에서
   쓰려면 `main`까지 올라가야 합니다. workflow와 운영자 도구 갱신이 모두 `main` tip을
   기준으로 돕니다.
4. `github-oidc-ssm` CloudFormation 스택 갱신과 GitHub 변수 세 개 설정(관리자). **미실행.**
   스택 출력 `HostStandbyDocumentName`, `ProductionSelfStatusDocumentName`,
   `ProductionSelfDeployDocumentName`을 각각 `AWS_HOST_STANDBY_DOCUMENT_NAME`,
   `AWS_PRODUCTION_SELF_STATUS_DOCUMENT_NAME`, `AWS_PRODUCTION_SELF_DEPLOY_DOCUMENT_NAME`에
   넣습니다. 기존 문서와 역할 이름은 바뀌지 않습니다.
5. 통제된 첫 부팅으로 대기 상태 스냅샷 만들기(사용자 승인). **미실행.**
   - 조건: LightNode가 정상이고 실행권을 쥐고 있음, `main` merge와 운영 DB 패치를 멈춤,
     운영 DNS가 LightNode를 가리킴, Sentry DB 경로 전환이 꺼져 있음(`EnableFailover`, B2).
   - 순서: 인스턴스 시작 → `node-status production` → `operator-upgrade` → `standby` →
     인스턴스 중지 → 새 스냅샷.
   - 시작부터 `standby`가 끝날 때까지 몇 분 동안 옛 API(11월 3일 이미지)가 운영 DB에 붙어
     있습니다. DNS가 가리키지 않아 일반 요청은 오지 않고, LightNode가 실행권을 갱신하는
     동안에는 예약 작업을 가져가지 못합니다. B2 표의 나머지 경로는 그대로 적용됩니다.
   - 끝나면 5절 11번을 확인합니다: 새 스냅샷으로 만든 서버가 API 꺼진 채로 뜨는지.
6. 3절의 남은 항목을 닫고 리허설. **미실행.**
7. 원본 인스턴스 삭제(관리자 콘솔, 승인 필요). 고정 IP는 삭제하지 않습니다. **미실행.**

중지된 인스턴스도 요금이 나갑니다. 비용이 줄어드는 시점은 7번입니다.
