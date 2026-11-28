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
| `github-oidc-ssm` CloudFormation 스택, GitHub 변수 `AWS_PRODUCTION_*`, `AWS_HOST_STANDBY_DOCUMENT_NAME`, `LIGHTSAIL_SSM_TARGET_TAG` | `Lightsail operations` workflow가 사용합니다. 호스트에 명령을 보내는 작업은 환경과 확인 범위에 맞는 문서 변수 하나를 고르고, 그 변수가 비어 있으면 변수 이름을 찍고 실패합니다. `node-status`는 문서 변수를 쓰지 않습니다. 태그나 역할 변수가 비어 있으면 변수 이름 없이 먼저 실패할 수 있습니다 |

`lightsail-cli.sh` 명령. 운영 환경 명령은 GitHub `production` 환경 잡을 거칩니다. 이 잡이
사람의 승인을 기다리는 것은 그 환경에 필수 승인자가 설정돼 있을 때뿐이고, 2026-11-28에는
대기 없이 통과했습니다(5절 7번). 상태를 바꾸는 작업은 그와 별도로 실행 직전에 사용자 승인을
받습니다.

| 명령 | 하는 일 | 호스트에 명령을 보내는가 |
|---|---|---|
| `node-status production` | 태그가 맞는 노드의 전체 수와 Online 수, 노드별 ping 상태·마지막 ping 시각·에이전트 버전을 출력. 정확히 한 노드가 Online일 때만 성공 | 아니오 |
| `standby` | 호스트의 운영 API를 먼저 멈추고 이어서 preview API를 멈춤. 운영 DNS가 LightNode를 가리킬 때만 실행됨. 중간에 실패하면 한쪽만 멈춘 상태일 수 있음 | 예 |
| `status production --self` | 공개 주소를 쓰지 않고 이 호스트의 컨테이너 상태, 이미지 일치, 내부 readiness를 확인 | 예 |
| `deploy production --self` | `main` tip 이미지를 배포하고 위와 같은 방식으로 확인 | 예 |
| `status production`, `deploy production` | 위 확인에 더해 운영 공개 주소의 readiness와 liveness까지 확인. 응답한 서버가 어느 쪽인지는 구분하지 않습니다. **대기 상태에서 DNS가 LightNode를 가리킬 때 `--self` 없는 `deploy production`을 실행하지 않습니다**(B1) | 예 |
| `operator-upgrade` | 호스트의 운영자 도구 번들을 `main` tip 버전으로 다시 설치하고 검증. 내용이 같아도 호스트를 바꾸는 작업 | 예 |

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
  있고 `healthy`인지, 재시작한 적이 없는지, 스케줄러 설정과 실행 주체 설정(lease 모드와
  holder ID)이 맞는지, 기록된 이미지와 실제 이미지가 같은지, 컨테이너 안에서
  `/health/ready`가 통과하는지입니다.
- `--self`가 확인하지 않는 것: 공개 주소로 들어온 요청이 이 호스트에 도달하는지, 실행권을
  얻을 자격(`provider`)이 맞는지, 실행권을 실제로 쥐고 있는지. 뒤의 둘은 이 호스트의
  `/health/lease` 응답으로 따로 확인합니다(4절).
- `--self` 출력의 `edge_route`와 `edge_tls`는 이 호스트의 Caddy에 `127.0.0.1`로 직접 물어본
  결과입니다. `edge_route=ok`는 운영 hostname으로 보낸 loopback HTTPS `/health` 요청에서
  `status: ok` 응답을 받았다는 뜻입니다. `edge_tls=ok`는 인증서를 검증하는 첫 요청이
  통과했다는 뜻입니다. 둘 다 통과 조건이 아니고 workflow에 경고로만 표시됩니다. 실패 값만으로는
  원인을 가릴 수 없습니다: Caddy가 떠 있지 않은 경우, 이 이름으로 TLS 연결 자체가 안 되는
  경우(쓸 수 있는 인증서가 없음), 호스트에서 loopback으로 Caddy에 닿지 않는 경우가 모두
  `edge_route=failed`로 나옵니다.
- 인증서가 없어 `edge_route`가 실패하는 호스트는 DNS를 옮기기 전에는 이 확인을 통과할 수
  없고, 인증서는 DNS가 이 호스트를 가리켜야 새로 받을 수 있습니다. 이 경우 어떻게 진행할지는
  정해져 있지 않습니다(결정). 스냅샷 안의 인증서로 통과하는지는 리허설에서 확인합니다(5절).
- **대기 상태의 호스트에 `--self` 없이 `deploy production`을 실행하면 안 됩니다.** DNS가
  LightNode를 가리키는 동안에는 공개 주소 확인이 LightNode의 응답으로 통과하고, Lightsail
  API가 스케줄러가 켜진 채로 떠 있게 됩니다. workflow는 이 조합을 막지 않습니다. `standby`와
  달리 배포에는 DNS 확인이 없습니다.

남은 것: 이 도구를 호스트에 적용하고(6절), 4절의 순서와 위 인증서 경우의 처리를 사용자가
승인합니다(결정).

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

BJJ-605에서 `standby` 명령을 추가했습니다. 호스트의 운영 API 컨테이너를 `docker stop`으로
멈추고, 이어서 preview API 컨테이너를 멈춥니다. 각 환경에서 멈춘 뒤 다시 조회해 남아 있으면
실패로 끝납니다. 운영 쪽이 실패하면 preview는 시도하지 않고, preview 쪽이 실패하면 운영만
멈춘 상태로 남습니다. 실패했을 때는 두 환경의 상태를 각각 확인합니다.

`unless-stopped` 정책은 이렇게 멈춘 컨테이너를 Docker가 다시 시작되거나 서버가 재부팅돼도
띄우지 않는다고 Docker 문서에 적혀 있습니다. 이 호스트에서, 그리고 스냅샷에서 만든
서버에서 실제로 그런지는 확인한 적이 없습니다(5절 11번). 멈춘 API를 다시 만드는 경로는
`deploy`, 호스트 관리자가 직접 실행하는 rollback, 그리고 아래의 `db-reconcile`입니다.

아직 닫히지 않은 부분:

- **지금의 인스턴스와 스냅샷에는 적용되지 않았습니다.** 한 번은 켜서 `standby`를 실행하고
  새 스냅샷을 떠야 합니다(6절의 통제된 첫 부팅). 그동안은 위 표가 그대로 적용됩니다.
- **DB 경로 전환(`db-reconcile`)이 대기 상태의 API를 다시 띄울 수 있습니다.** Sentry DB 경로
  전환 스택(`*-db-failover`)은 운영용과 preview용이 따로 있을 수 있고, 둘 다 같은 호스트에
  고정 명령을 보냅니다. `EnableFailover`가 켜져 있으면 worker가 경로를 바꿀 때 API 컨테이너를
  다시 만들며, 그 API가 대기 상태였는지는 확인하지 않습니다. `EnableFailover`를 끄면 새
  작업만 멈춥니다. 이미 시작한 worker 실행이나 이미 보낸 명령은 남아 있을 수 있고, 인스턴스가
  꺼져 있는 동안 보낸 명령이 시작 직후에 전달될 수도 있습니다.
  **Lightsail을 시작하기 전에 같은 호스트를 대상으로 하는 운영·preview 스택을 모두 확인하고,
  배포돼 있으면 `EnableFailover`를 끄고, 이미 시작한 worker 실행과 `db-reconcile` 명령이 모두
  끝났는지 확인합니다. Lightsail이 대기하는 동안 이 설정을 유지합니다.** 스택의 배포 여부와
  이 값은 아직 확인하지 못했습니다(5절 8·9번). 호스트 쪽에서 막는 것은 worker 변경이 함께
  필요해 BJJ-605에 넣지 않았습니다.
- `standby`는 운영과 preview 두 환경을 멈추지만 workflow의 동시 실행 제한은 운영 환경
  기준입니다. `preview` 브랜치에서 Lightsail preview 작업을 동시에 돌리지 않습니다.
- 리허설을 운영 DB에 붙인 채 할지 격리된 대상으로 할지는 사용자가 정합니다(결정).

### B3. 등록만 확인하는 조회 (도구 구현 완료, 실제 호스트 확인은 미검증)

`lightsail-cli.sh node-status production`은 `DeploymentTarget` 태그가 맞는 노드의 전체 수와
Online 수, 노드별 ping 상태·마지막 ping 시각·에이전트 버전을 출력하고 호스트에 명령을 보내지
않습니다. 정확히 한 노드가 Online일 때만 성공합니다. 새 AWS 문서 없이 기존 역할의 조회 권한을
쓰도록 만들어졌습니다. 배포된 역할과 변수로 실제로 동작하는지, 복원한 인스턴스가 노드
하나로 등록되는지는 확인한 적이 없습니다(5절 1번). 조건을 충족하지 않으면 다음 단계로 가지
않고 등록 상태부터 확인합니다.

workflow가 실패했을 때는 어느 단계에서 끝났는지로 원인을 가립니다.

| 끝난 지점 | 보이는 것 | 뜻 |
|---|---|---|
| 승인, 설정 확인, 이미지 조회, AWS 인증 | 해당 workflow 단계가 실패. 고른 문서 변수가 비어 있으면 그 변수 이름이 찍힙니다 | 호스트와 무관합니다. `node-status`도 여기서 끝날 수 있습니다 |
| 등록 조회 | `managed_nodes=`와 `online_nodes=`가 찍힌 뒤 `The Lightsail host is not registered exactly once and online.` | 등록 문제. 모든 작업이 명령을 보내기 전에 이 조회를 합니다 |
| 명령 전송 | `send-command` 호출이 실패 | 노드는 등록돼 있는데 권한이나 문서 문제로 보내지 못함 |
| 명령 추적 | 최종 상태 줄 없이 실패 | 보낸 명령의 호출 기록이 예상한 노드에서 확인되지 않음 |
| 호스트 실행 | `Systems Manager operation failed with status: ...`만 찍히고 호스트 출력은 없음 | 명령이 호스트에 도달하지 않았거나, 시간 초과이거나, 호스트에서 실행된 명령이 실패로 끝남. 호스트 안의 확인(예: 공개 주소 확인)이 실패한 경우도 여기에 해당합니다. 상세는 권한이 있는 운영자가 고정 진단 문서로 봅니다 |
| workflow의 결과 검사 | 호스트 출력이 찍힌 뒤 실패. `operator-upgrade`만 성공 표시를 확인한 뒤에 출력합니다 | 호스트 명령은 성공으로 끝났는데 출력이 기대와 다름. 호스트의 복구는 돌지 않습니다(B5) |

뒤의 다섯은 재등록으로 해결되지 않습니다. DNS 전환 전의 `--self` 없는 `status`는 LightNode가
살아 있으면 LightNode의 응답으로 통과하고, 죽어 있으면 "호스트 실행"에서 실패합니다.

### B4. 배포할 이미지가 없을 수 있습니다 (절차)

`lightsail-cli.sh deploy production`은 실행 시점의 `main` tip만 배포합니다. 다른 SHA는
고를 수 없고, 호스트는 tip이 아닌 SHA를 거부합니다.

- 백엔드 경로를 건드리지 않은 push(예: frontend만)가 `main` tip이면 그 SHA의 이미지가
  없습니다. 이미지 조회 단계에서 실패합니다.
- 승인을 기다리는 사이 `main`이 움직이면 호스트가 거부합니다.

4절의 순서에서는 배포가 DNS 전환보다 먼저이므로 이 실패는 DNS를 옮기기 전에 드러나고,
대기 상태로 뜬 서버의 API는 꺼진 채로 남습니다. 전환 뒤의 배포에서 이 실패가 나면 떠 있던
API가 그대로 남습니다. 전환을 시작하기 전에 `main` tip SHA의 이미지 digest가 조회되는지
확인하고, 전환이 끝날 때까지 `main` merge를 멈춥니다. tip에 이미지가 없을 때 이미지를
만드는 승인된 방법은 아직 없습니다.

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
- 배포가 실패했을 때의 동작은 실패한 지점과, 배포를 시작할 때 API가 떠 있었는지에 따라
  다릅니다(BJJ-605).
  - 이미지 받기·검증이나 migration(사전 확인 포함)이 실패하면 API를 활성화하기 전에 끝납니다.
    컨테이너는 건드리지 않습니다. 꺼져 있던 API는 꺼진 채로, 떠 있던 API는 그대로 남습니다.
  - 그 뒤의 호스트 배포가 실패하면 복구를 **시도**합니다. 시작할 때 API가 꺼져 있었으면
    새로 뜬 API를 멈추고 기록된 이미지 정보 네 가지를 배포 전 값으로 되돌린 뒤, 떠 있는
    API가 없는지 다시 확인합니다. 직전 이미지는 띄우지 않습니다. 시작할 때 API가 떠
    있었으면 배포 직전 이미지로 롤백을 시도합니다.
  - 복구 자체가 실패할 수 있습니다. 그때는 `Deployment and automatic recovery both failed`로
    끝나고, 새 API가 떠 있는 채로 남을 수 있습니다.
  - 호스트 배포는 성공으로 끝났는데 workflow의 결과 검사가 실패하면 호스트의 복구는 돌지
    않습니다. 새 API가 떠 있는 채로 남습니다.
  - 그래서 배포가 실패로 끝나면 다음 단계로 가기 전에 실제 상태를 확인합니다. API가 꺼져
    있어야 하는 경우에는 `standby`를 다시 실행해 두 환경의 `standby=ok`를 확인합니다(DNS가
    LightNode를 가리키는 동안에만 실행됩니다). workflow에는 실패 상태만 찍히고 호스트의 상세
    기록은 호스트에 남습니다.
  - 어느 경우든 이미 적용된 DB 변경은 되돌려지지 않습니다.

닫는 방법: 배포할 이미지의 migration과 운영 DB의 단계 적용 상태를 전환 전에 확인하는 절차를
정하고(4절 2단계), Lightsail이 운영을 맡은 뒤의 배포가 실패했을 때 돌아갈, DB와 맞는 복구용
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
스냅샷)가 끝나 있다는 것을 전제로 합니다. 어느 단계든 통과하지 못하면 다음 단계로 가지
않습니다.

1. **전환 결정 (B6).** LightNode가 일시적 장애가 아닌지 확인합니다. `main` merge를 멈추고,
   운영 DB 패치(`preview` merge, 수동 실행, 끝나지 않은 모든 실행)를 1절대로 통제합니다.
2. **이미지와 DB 전제 확인 (B4, B5).** `main` tip SHA의 이미지 digest가 조회되는지
   확인합니다. 그 이미지의 migration과 운영 DB의 단계 적용 상태를 확인합니다. case 키 변경의
   단계 적용이 필요하면 `CI_AUTOMATION.md`의 "Release and recovery contract" 절차(기존 쓰기
   주체 중지와 단계 적용)를 별도 승인으로 먼저 끝냅니다. 여기서 막히면 인스턴스를 시작하지
   않습니다.
3. **인스턴스 준비 (B2).** 시작하기 전에 운영·preview DB 경로 전환 스택의 `EnableFailover`가
   꺼져 있고 진행 중인 실행과 명령이 없는지 확인합니다(B2). 원본이 중지 상태로 남아 있으면
   **시작**합니다(에이전트 IAM). 삭제한 뒤라면 관리자 콘솔에서 대기 상태로 뜬 가장 최근
   스냅샷으로 만듭니다: 리전 `ap-northeast-2`, 번들 `medium_3_0`, 고정 IP 연결, 22는 작업
   장비의 `/32`만. 80·443은 9단계 전까지 닫아 둡니다.
4. **등록 확인 (B3).** `lightsail-cli.sh node-status production`. 노드가 없거나, Offline이거나,
   둘 이상이면 멈추고 등록 상태를 확인합니다.
5. **대기 상태 확인 (B2).** `lightsail-cli.sh standby`. 두 환경의 `standby=ok`를 확인합니다.
   대기 상태 스냅샷에서 뜬 서버라면 `api_stopped=0`이 나와야 합니다. 0이 아니면 API가 켜진
   채로 부팅됐다는 뜻이고, 그동안 B2 표의 경로가 열려 있었습니다.
6. **운영자 도구 갱신 (B5).** `lightsail-cli.sh operator-upgrade`. 요청한 SHA가 현재 `main`
   tip과 같을 때 운영자 도구 번들을 다시 설치하고 검증합니다. 스냅샷 안의 번들과 내용이
   같아도 호스트를 바꾸는 작업입니다.
7. **실행 주체 설정.** 호스트 관리자가
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
8. **배포와 스케줄러 활성화 (B1, B5).** `lightsail-cli.sh deploy production --self`.
   **`--self`를 빼지 않습니다**(B1). `main` tip 이미지로 API가 뜨고, 통과 여부는 이 호스트
   안에서 확인합니다. 실패로 끝나면 B5대로 실제 상태를 확인한 뒤에만 다시 시도합니다.
   - 통과하면 출력의 `edge_route`와 `edge_tls`를 봅니다. `edge_route`가 `ok`가 아니면 DNS를
     옮기지 않고 멈춥니다(인증서가 없어 막히는 경우의 처리는 B1에서 정합니다).
   - 이 단계는 스케줄러를 **켜는** 단계이고, 실행권을 넘겨받는 단계가 아닙니다. 이때부터
     Lightsail API가 약 20초마다 실행권 획득을 시도합니다. 실행권은 기존 보유자가
     반납하거나 마지막 DB 갱신에서 90초가 지나 만료된 뒤, 획득 시도에 성공한 서버로
     넘어갑니다. 만료 시각에 바로 넘어오는 것이 아닙니다.
   - Lightsail의 고정 IP를 대상으로 운영 hostname을 지정해 `/health/lease`를 직접 조회하고,
     `provider`가 `lightsail`이고 `eligible`이 `true`인지 확인합니다. LightNode가 살아서
     갱신 중이면 `held`가 `false`인 것이 정상입니다. LightNode가 재시작 등으로 실행권을
     반납하면 먼저 획득에 성공한 쪽이 쥐고, Lightsail이 쥐면 Lightsail이 갱신하는 동안
     LightNode는 되찾지 못합니다. 실행권을 쥔 서버는 어느 순간에도 하나입니다.
   - DNS를 옮기기 전에 실제 획득(`held=true`)까지 요구할지는 정해져 있지 않습니다(B1, 결정).
     LightNode가 살아 있으면 LightNode를 내리기 전에는 획득할 수 없습니다.
9. **DNS 전환 (B1).** 80·443 인바운드를 엽니다(관리자 콘솔). 그 뒤
   `backend/deploy/fallback-server/VERCEL_DNS_FAILOVER.md`의 "Cutover, manual check, and
   failback"에 있는 **수동 역방향 절차**를 따릅니다. 자동 controller는 AWS에서 Fallback
   방향만 바꾸므로 이 방향에는 쓰지 않습니다.
   - DNS controller를 해제(disarm)하고, 끝나지 않은 변경이 있으면 실제 레코드와 먼저 맞춥니다.
   - Lightsail readiness(8단계)와 전자서명·문서 상태를 확인합니다.
   - 현재 레코드를 읽어 승인된 LightNode 값인지 확인합니다.
   - 별도 승인을 받고 같은 `api` A 레코드의 값만 Lightsail 고정 IP로 바꿉니다(TTL 60).
   - 바로 다시 읽어 대상과 TTL을 확인합니다. 응답이 시간 초과이거나 모호하면 실제 레코드를
     확인하기 전에는 다시 바꾸지 않습니다.

   LightNode가 살아 있으면 DNS가 퍼지는 동안 두 서버가 함께 요청을 받고 둘 다 운영 DB에
   씁니다. 8단계에서 `edge_tls`가 `ok`가 아니었다면 Caddy가 인증서를 새로 받을 때까지
   HTTPS가 실패할 수 있습니다.
10. **공개 경로가 Lightsail인지 확인.** LightNode를 내리기 전에 다음을 모두 확인합니다.
    - Vercel의 A 레코드와 공개 DNS 응답이 Lightsail 고정 IP입니다.
    - 고정 IP를 대상으로 운영 hostname의 TLS와 `/health/ready`가 통과합니다.
    - 일반 공개 경로로 조회한 `/health/lease`의 `provider`가 `lightsail`입니다.
    - `lightsail-cli.sh status production`(`--self` 없음)이 통과합니다. 이 명령은 응답한
      서버가 Lightsail인지 구분하지 않으므로 위 세 가지를 대신하지 못합니다.
11. **LightNode 쓰기 중지.** 접속되면 root 운영자의 `operator.sh stop`, 안 되면 콘솔에서
    전원을 끕니다. 그 뒤 Lightsail의 `/health/lease`가 아래와 같아질 때까지 기다립니다.
    정상 종료에서 실행권이 반납되면 다음 획득 시도에서, 반납되지 않으면(DB 응답이 늦거나
    실패한 경우 포함) 마지막 갱신에서 90초가 지난 뒤의 획득 시도에서 넘어옵니다.

    ```json
    {"mode":"required","holderId":"lightsail","held":true,"provider":"lightsail","eligible":true,"eligibilityReason":"provider_match"}
    ```

12. **확인.** `/health/ready`가 200인지 보고, 로그인, 고객 조회, 제공기록지 링크 열기, 테스트
    번호로 문자 1건을 확인합니다.
13. **전환 뒤.** LightNode는 꺼 둡니다. 전환 중의 운영 배포는 `lightsail-cli.sh deploy
    production`으로만 합니다. 이때부터의 배포 실패는 직전 이미지로 롤백을 시도합니다(B5).

## 5. 리허설로 확인할 것

리허설은 6절의 대기 상태 스냅샷이 만들어진 뒤에 사용자 승인 하에 합니다.

| # | 확인할 것 | 지금 상태 |
|---|---|---|
| 1 | 복원한 인스턴스가 Systems Manager에 online 노드 하나로 잡히는가 | 미확인 |
| 2 | 복원한 인스턴스에서 Caddy edge와 외부 volume·network가 그대로 뜨는가 | 미확인. 새로 띄우는 절차는 문서에 없습니다 |
| 3 | 운영 hostname으로 옮겼을 때 TLS 인증서가 유효한가, 재발급에 얼마나 걸리는가 | 미확인. DNS를 옮기지 않는 리허설로는 확인할 수 없습니다. 스냅샷 안의 인증서로 DNS 전환 전의 `edge_route` 확인을 통과하는지는 리허설에서 볼 수 있습니다 |
| 4 | Lightsail 고정 IP가 Aligo 발신 IP로 등록돼 있는가 | 미확인 |
| 5 | 운영 DB(Supabase)에 접속 IP 제한이 있는가 | 미확인 |
| 6 | 인스턴스 준비부터 확인 통과까지 걸리는 실제 시간 | 미측정 |
| 7 | GitHub `production` 환경에 승인자가 설정돼 있는가 | 2026-11-28에 승인 잡이 대기 없이 통과했습니다. BJJ-601에서 설정합니다 |
| 8 | Sentry DB 경로 전환 스택(`*-db-failover`)이 배포돼 있는가 (운영용과 preview용 각각) | 미확인 |
| 9 | 8번이 배포돼 있다면 `EnableFailover`가 켜져 있는가 | 미확인. 기본값은 꺼짐이고, 꺼져 있으면 worker가 노드를 조회하지 않습니다 |
| 10 | 8번의 알람에 알림 대상(topic)이 연결돼 있는가 | 미확인. 연결돼 있지 않으면 알람이 울려도 알림이 가지 않습니다 |
| 11 | `standby` 뒤 재부팅하거나 스냅샷에서 복원했을 때 API가 꺼진 채로 있는가 | 미확인. Docker 문서 기준으로는 그렇습니다 |
| 12 | 호스트에서 `127.0.0.1`의 443으로 Caddy에 닿는가(`edge_route`, `edge_tls`가 값을 내는가) | 미확인. Docker 네트워크 설정에 따라 닿지 않을 수 있습니다 |
| 13 | 호스트 `backend.env`의 `PRODUCTION_DEPLOYMENT_PROVIDER` 값 | 미확인 |
| 14 | API 컨테이너가 일시정지나 재시작 반복 상태일 때 `standby`가 멈추는가 | 미확인. 테스트는 Docker를 흉내 낸 대역으로만 돌렸습니다. `standby`는 멈춘 뒤 다시 조회해서 남아 있으면 실패로 끝납니다 |
| 15 | Lightsail 방화벽에서 80·443을 닫은 상태로 Systems Manager 명령이 호스트에 전달되는가 | 미확인. 에이전트는 바깥으로 나가는 연결만 쓰는 것으로 알려져 있습니다 |
| 16 | 고정 IP를 대상으로 `/health/lease`를 직접 조회할 수 있는가 | 미확인. 4절 8·10단계가 이 조회에 의존합니다 |

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
   - 시작하기 전에 모두 확인합니다. 하나라도 확인할 수 없으면 시작을 미룹니다.
     - LightNode가 정상이고 실행권을 쥐고 갱신 중입니다. 이 작업 동안 LightNode를 배포하거나
       재시작하지 않습니다(`main` merge와 운영 DB 패치를 멈춥니다). LightNode가 실행권을
       놓으면 옛 API가 가져가 예약 작업을 돌릴 수 있습니다.
     - 운영 DNS가 LightNode를 가리킵니다.
     - Lightsail 방화벽에서 80·443 인바운드가 닫혀 있습니다(관리자 콘솔). DNS가 가리키지
       않아도 고정 IP로 운영 hostname을 지정해 들어온 요청은 옛 API에 닿습니다.
     - 운영·preview DB 경로 전환 스택의 `EnableFailover`가 꺼져 있고, 이미 시작한 worker
       실행과 `db-reconcile` 명령이 모두 끝났습니다(B2).
     - GitHub `production` 환경에 승인자가 설정돼 있는지 확인합니다. 없으면 승인 잡이
       기다리지 않으므로 각 명령을 실행 직전에 사용자에게 따로 확인받습니다.
     - 시작부터 `standby` 완료까지의 최대 허용 시간과, 실패했을 때 인스턴스를 바로 중지하는
       것을 사용자가 미리 승인합니다. 승인 대기만 최대 30분, 명령 하나가 최대 40분까지 걸릴
       수 있어 한도를 정하지 않으면 끝나는 시점이 보장되지 않습니다.
   - 순서: 인스턴스 시작 → `node-status production` → `operator-upgrade` → `standby` →
     인스턴스 중지 → 새 스냅샷.
   - 등록 조회, 도구 갱신, `standby` 중 하나라도 실패하거나 한도를 넘으면 인스턴스를 중지하고
     중지 상태를 확인합니다. 두 환경의 `standby=ok`를 확인한 경우에만 새 스냅샷을 만듭니다.
   - 시작부터 `standby`가 끝날 때까지 옛 API(11월 3일 이미지)가 운영 DB에 붙어 있습니다.
     인바운드를 닫아도 운영 DB 연결과 B2 표의 시작 시 쓰기 경로는 남습니다.
   - 80·443은 대기하는 동안 닫아 두고, 장애 전환의 DNS 전환 직전에 엽니다(4절 9단계).
   - 끝나면 5절 11번을 확인합니다: 새 스냅샷으로 만든 서버가 API 꺼진 채로 뜨는지.
6. 3절의 남은 항목을 닫고 리허설. **미실행.**
7. 원본 인스턴스 삭제(관리자 콘솔, 승인 필요). 고정 IP는 삭제하지 않습니다. **미실행.**

중지된 인스턴스도 요금이 나갑니다. 비용이 줄어드는 시점은 7번입니다.
