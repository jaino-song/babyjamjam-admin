# Lightsail cold standby 장애 전환 runbook

> **상태: 리허설 전 (2026-11-28 작성, BJJ-598).** 이 절차는 코드와 문서를 읽고 쓴 것이며
> 아직 한 번도 실행해 보지 않았습니다. 아래 "리허설로 닫아야 할 것"이 모두 닫히기 전에는
> Lightsail 인스턴스를 삭제하지 않습니다.

## 1. 구조

| 역할 | 호스트 | 운영 DB 쓰기 |
|---|---|---|
| 운영 | LightNode 하나 | API, 스케줄러, 문서 잡, 문자 발송 전부 |
| 대기 | AWS Lightsail cold standby: 스냅샷만 보관, 인스턴스 없음 | 없음 |
| 스테이징 | Google Cloud Run | BJJ-599에서 분리 |

- `main` push는 LightNode에만 배포합니다. `api.babyjamjam.com`이 Lightsail을 가리키는 동안
  `main` push의 `resolve backend deployment target` 잡은 **실패**하고 아무 곳에도 배포하지
  않습니다. 장애 전환 중의 배포는 사람이 `Lightsail operations` workflow로 직접 합니다.
- 어떤 순간에도 스케줄러 실행권(`scheduler_lease`의 `background-owner` 행, ADR-010)을 가진
  호스트는 하나입니다. 실행권은 예약 작업만 막고 **API 요청은 막지 않습니다.** 한 호스트의
  쓰기를 완전히 멈추려면 그 호스트의 API 컨테이너를 내려야 합니다.

## 2. 평소에 유지해야 하는 것

| 항목 | 이유 |
|---|---|
| Lightsail 인스턴스 스냅샷 1개 이상 | 복원 원본 |
| Lightsail 고정 IP를 삭제하지 않고 보유 | GitHub secret `LIGHTSAIL_DNS_SHA256`이 이 IP의 해시입니다. IP가 바뀌면 해시가 맞지 않아 `main` push가 "승인되지 않은 운영 경로"로 실패하고, Aligo 발신 IP 등록도 다시 해야 합니다 |
| GHCR 이미지 `ghcr.io/jaino-song/babyjamjam-admin-backend` 공개 pull 유지 | 호스트에는 registry 자격 증명이 없습니다 (`CI_AUTOMATION.md`) |
| `github-oidc-ssm` CloudFormation 스택, GitHub 변수 `AWS_PRODUCTION_*`, `LIGHTSAIL_SSM_TARGET_TAG` | `Lightsail operations` workflow가 사용합니다 |

스냅샷 안의 이미지는 스냅샷을 뜬 시점의 운영 버전에서 멈춰 있습니다. 복원 직후의 API는
그 옛 버전입니다(4단계 주의 참고).

## 3. 누가 무엇을 할 수 있는가

| 작업 | 실행 주체 |
|---|---|
| 스냅샷에서 인스턴스 생성, 고정 IP 연결, 방화벽, 인스턴스 삭제 | AWS 계정 관리자(콘솔). 에이전트 IAM `agent-lightsail-operator`는 생성·삭제·네트워크 변경 권한이 없습니다 |
| 인스턴스 시작·중지·재부팅, 스냅샷 생성, 상태 조회 | 에이전트 IAM, 실행 직전 사용자 승인 |
| Lightsail 호스트의 `backend.env` 수정 | 호스트 관리자만(root 전용 파일). 에이전트는 값을 읽거나 쓰지 않습니다 |
| Lightsail 배포·상태 | `Lightsail operations` workflow (`backend/deploy/lightsail/lightsail-cli.sh`) |
| DNS `api` A 레코드 변경 | Vercel DNS 관리 권한이 있는 사람 (`backend/deploy/fallback-server/VERCEL_DNS_FAILOVER.md`) |
| LightNode API 중지 | LightNode root 운영자(`backend/deploy/fallback-server/operator.sh stop`) 또는 LightNode 콘솔에서 전원 끄기 |

## 4. 장애 전환 절차 (LightNode → Lightsail)

각 단계는 실행 직전에 사용자 승인을 받습니다. 운영 서버·운영 DB·DNS를 바꾸는 단계입니다.

### 0단계. 전환 결정과 LightNode 쓰기 차단

1. LightNode가 실제로 복구 불가인지 확인합니다. 일시적 장애면 전환하지 않습니다.
2. LightNode가 조금이라도 살아 있으면 API를 내립니다. 접속되면 root 운영자의
   `operator.sh stop`, 접속이 안 되면 LightNode 콘솔에서 인스턴스 전원을 끕니다.
   API가 살아 있는 채로 DNS만 옮기면 캐시된 DNS를 가진 클라이언트의 요청을 LightNode가
   계속 처리합니다.
3. LightNode가 정상 종료하면 실행권을 즉시 반납합니다. 비정상 종료면 마지막 갱신에서
   최대 90초 뒤에 만료됩니다.

### 1단계. 인스턴스 복원 (관리자 콘솔)

1. 가장 최근 스냅샷에서 인스턴스를 만듭니다. 리전 `ap-northeast-2`, 번들 `medium_3_0`
   (2 vCPU / 4GB / 80GB).
2. 보유 중인 고정 IP를 새 인스턴스에 연결합니다.
3. 방화벽에서 80, 443을 엽니다. 22는 작업 장비의 `/32`만 허용합니다
   (`lightsail-agent-operator.md`의 SSH 규칙).

부팅하면 `restart: unless-stopped` 때문에 **스냅샷 시점의 옛 API, Valkey, Caddy가 자동으로
뜹니다.** 이 시점에는 DNS가 아직 오지 않아 트래픽이 없고, `PRODUCTION_DEPLOYMENT_PROVIDER`가
설정되지 않은 한 예약 작업도 실행하지 않습니다(`provider_not_configured`).

### 2단계. Systems Manager 등록 확인

`Lightsail operations`는 `DeploymentTarget=babyjamjam-admin-server` 태그를 가진 online
managed node가 **정확히 하나**일 때만 동작합니다.

```bash
backend/deploy/lightsail/lightsail-cli.sh status production
```

실패하면 `CI_AUTOMATION.md`의 hybrid activation 절차로 노드를 다시 등록하고, 예전 등록이
남아 둘로 보이면 예전 것을 해제합니다. 스냅샷 복원 뒤 등록이 그대로 살아나는지는 아직
확인하지 못했습니다(리허설 항목).

### 3단계. 실행 주체 설정 (호스트 관리자)

`/opt/babyjamjam/environments/production/backend.env`(root 전용)에 아래 키가 있어야 합니다.
값은 이 문서나 로그에 남기지 않는 비밀이 아니라 고정 설정값입니다.

```
SCHEDULERS_ENABLED=true
SCHEDULER_LEASE_MODE=required
SCHEDULER_LEASE_HOLDER_ID=lightsail
PRODUCTION_DEPLOYMENT_PROVIDER=lightsail
```

앞의 세 개는 스냅샷에 이미 들어 있습니다. 마지막 키가 없으면 Lightsail은 API만 처리하고
예약 작업·문서 잡·문자 발송을 하지 않습니다. 설정은 프로세스 시작 때 읽으므로 5단계의
배포(컨테이너 재생성)에서 반영됩니다.

`SCHEDULER_LEASE_MODE`를 `off`로 두지 않습니다. `off`이고 실행 주체가 일치하면 DB 실행권
확인 없이 예약 작업이 돕니다.

### 4단계. DNS 전환

`VERCEL_DNS_FAILOVER.md`의 절차로 `api` A 레코드를 Lightsail 고정 IP로 바꿉니다(TTL 60).
바꾸기 전 값을 롤백 근거로 기록하고, 바꾼 뒤 두 개 이상의 resolver에서 확인합니다.

> **주의 (현재 도구의 한계).** 5단계의 배포는 공개 주소 `https://api.babyjamjam.com`의
> health를 통과 조건으로 봅니다. LightNode가 죽은 상태에서는 DNS를 먼저 옮기지 않으면
> 배포가 실패하고 롤백됩니다. 그래서 DNS 전환이 배포보다 먼저이고, **DNS 전환부터 5단계
> 완료까지 몇 분 동안은 스냅샷 시점의 옛 API가 운영 트래픽을 받습니다.** 스냅샷 이후에
> DB 구조가 바뀌었다면 이 구간의 요청은 실패하거나 잘못 쓸 수 있습니다. 이 구간을 줄이려면
> 4단계 직후 곧바로 5단계를 실행합니다. 구조적으로 없애려면 "리허설로 닫아야 할 것" 1번이
> 필요합니다.

Caddy 인증서는 DNS가 이 호스트를 가리킨 뒤에 발급·갱신됩니다. 스냅샷 안의 인증서가
만료됐으면 발급이 끝날 때까지 HTTPS가 실패합니다.

### 5단계. 현재 운영 버전 배포

```bash
backend/deploy/lightsail/lightsail-cli.sh deploy production
```

- 항상 `main`의 현재 tip을 배포합니다. 다른 SHA는 고를 수 없습니다.
- 호스트가 이미지를 받고, `prisma migrate deploy`를 실행하고(DB가 최신이면 변화 없음),
  컨테이너를 다시 만들고, health를 확인합니다. 실패하면 직전 이미지로 자동 롤백합니다.
- GitHub `production` 환경 승인이 걸려 있으면 승인합니다.

### 6단계. 확인

```bash
curl -sS https://api.babyjamjam.com/health/ready
curl -sS https://api.babyjamjam.com/health/lease
```

`/health/lease`가 아래와 같아야 Lightsail이 예약 작업을 소유한 것입니다.

```json
{"mode":"required","holderId":"lightsail","held":true,"provider":"lightsail","eligible":true,"eligibilityReason":"provider_match"}
```

`held`는 LightNode의 실행권이 만료되거나 반납된 뒤에 `true`가 됩니다(최대 90초). 그 뒤
로그인, 고객 조회, 제공기록지 링크 열기, 테스트 번호로 문자 1건을 확인합니다. 문자가
실패하면 Aligo 발신 IP 등록을 확인합니다.

### 7단계. 전환 뒤

- LightNode를 다시 켤 때는 active로 올리지 않습니다. 꺼 두거나 passive(`operator.sh deploy`)로만
  올립니다. active로 올라오면 실행권을 두고 경쟁하게 됩니다. DB 실행권이 동시 실행은 막지만,
  Lightsail이 재시작하는 순간 LightNode가 가져갈 수 있습니다.
- 전환 중의 모든 운영 배포는 5단계 명령으로 합니다. `main` push는 배포하지 않고 실패합니다.
- LightNode로 되돌리는 절차(failback)는 별도 승인 사항입니다. 순서는
  `docs/devops-deployment-rules.md` §4.1을 따르되 방향을 반대로 적용합니다: LightNode에 현재
  버전 배포와 확인 → DNS 전환 → Lightsail API 중지 → 스냅샷 → 인스턴스 삭제.

## 5. 리허설로 닫아야 할 것

인스턴스를 삭제하기 전에, 원본을 **중지**한 상태에서 스냅샷으로 두 번째 인스턴스를 만들어
아래를 확인합니다. 리허설은 사용자 승인 하에 진행하고, 리허설 인스턴스에는 DNS를 옮기지
않습니다.

| # | 확인할 것 | 지금 상태 |
|---|---|---|
| 1 | DNS 전환 전에 현재 버전을 배포할 수 있는가 | 불가. 배포 통과 조건이 공개 주소 health입니다. 호스트 자신을 대상으로 확인하는 방식이 운영자 도구(`ci-operator.sh`)에 필요합니다 |
| 2 | 복원한 인스턴스가 Systems Manager에 online 노드 하나로 잡히는가 | 미확인 |
| 3 | 복원한 인스턴스에서 Caddy edge와 외부 volume·network가 그대로 뜨는가 | 미확인. 새로 띄우는 절차는 문서에 없습니다 |
| 4 | 스냅샷 안의 TLS 인증서 만료 시 재발급에 걸리는 시간 | 미확인 |
| 5 | Lightsail 고정 IP가 Aligo 발신 IP로 등록돼 있는가 | 미확인. 이전 계획 문서의 체크 항목이 비어 있습니다 |
| 6 | 운영 DB(Supabase)에 접속 IP 제한이 있는가 | 미확인 |
| 7 | 복원부터 6단계 통과까지 걸리는 실제 시간 | 미측정 |
| 8 | GitHub `production` 환경에 승인자가 설정돼 있는가 | 2026-11-28 기준 승인 잡이 대기 없이 통과했습니다. BJJ-601에서 설정합니다 |
| 9 | Sentry DB 경로 전환 스택(`*-db-failover`)이 배포돼 있는가 | 미확인. 이 스택은 Lightsail 노드만 대상으로 하므로, 배포돼 있다면 인스턴스가 없는 동안 알람이 울립니다 |

## 6. Cold standby로 내리는 절차 (최초 1회)

1. 인스턴스 **중지** (에이전트 IAM, 승인 필요). 이 순간부터 Lightsail 런타임이 없습니다.
   되돌리려면 시작하면 됩니다.
   **완료: 2026-11-28 13:23 KST**, 인스턴스 `babyjamjam-admin-server`가 `stopped`.
2. 수동 스냅샷 생성 (에이전트 IAM, 승인 필요).
   **완료: 2026-11-28 13:34 KST**, 스냅샷 `babyjamjam-admin-server-cold-standby-20261128`
   (80GB, `available`). 중지된 상태에서 떴고, 안의 운영 이미지는 `8eefdbf2`(2026-11-03 배포분)입니다.
3. 위 5절의 리허설. **미실행.**
4. 리허설이 통과하면 원본 인스턴스 **삭제** (관리자 콘솔, 승인 필요). 고정 IP
   `babyjamjam-admin-server-static-ip`는 삭제하지 않습니다. 리허설 인스턴스도 삭제합니다.
   **미실행.**

중지된 인스턴스도 요금이 나갑니다. 비용이 줄어드는 시점은 4번입니다. 4번 전까지는
인스턴스가 중지 상태로 남아 있으므로, 장애가 나면 1단계(복원) 대신 인스턴스를 **시작**하고
2단계부터 진행합니다.
