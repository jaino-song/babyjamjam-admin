# Production background-job provider ownership

`PRODUCTION_DEPLOYMENT_PROVIDER=lightnode|lightsail` selects the host eligible to
contest the existing shared `background-owner` scheduler lease. Set the **same desired
provider on both production hosts**. Each host retains its own
`SCHEDULER_LEASE_HOLDER_ID=lightnode|lightsail`. This affects every scheduler using
the shared lease, including the electronic-document queue. It does not enable
`EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED`, document acceptance, provider egress, or
any release approval by itself; preserve those explicit gates.

This is per-process environment configuration, read at startup. It is not a shared
live control plane and does not follow DNS automatically. CI's approved DNS-hash
resolver remains deployment routing authority. A local `.env` edit cannot change a
remote process. Divergent host settings can leave both hosts eligible to contest;
the existing atomic DB lease remains the singleton boundary.

Production fails closed for missing, `none`, invalid provider, missing/unrecognized
explicit holder, or provider/holder mismatch, including lease mode `off`. API startup
still succeeds. `/health/lease` adds flat `provider` (`lightnode|lightsail|null`),
`eligible` (boolean) and bounded `eligibilityReason` fields to `mode`, `holderId`,
`held`. An eligible host can report `held=false` while the prior owner's lease expires.
Passive `SCHEDULERS_ENABLED=false` always remains standby and makes no lease DB calls.
Development `PRODUCTION_DEPLOYMENT_PROVIDER=none`, mode `off`, holder `local` retains
local execution without touching the lease DB. Preview remains passive.

## Current hold state

Lightsail failback remains **HOLD**. LightNode owns production API traffic and
background jobs; an available Lightsail API is not authority to transfer either.
Provider eligibility was introduced by #918. DNS routing, configured eligibility,
locally reported recent lease ownership, and completed work are distinct evidence.
The persistent LightNode runtime retains the `temporary-active` mode name with
`automatic_shutdown=disabled`; the enabled temporary-expiry lifecycle is a separate
legacy path, and passive standby never contests the lease.

During HOLD, retain the persistent owner's required-mode and held-lease checks.
Investigate a missing lease or stalled jobs through sanctioned observation and
approved recovery; do not accept missing jobs simply because Lightsail holds the
lease. Failback requires a separate explicit approval for the controlled handover
below, including routing and job ownership verification. This document update
does not authorize a provider change or certify either host's environment.

## Hard gates before production merge

A production merge automatically deploys to the resolved host. Do not merge until
an approved host administrator has provisioned the selected provider in that host's
root-only runtime environment and confirmed it agrees with the CI DNS-resolved target.
Provision the same desired value on the other host through its approved administrator
path. This code and CI do not provision host environment files or operate inactive hosts.
No new remote command or privileged interface is introduced.

Before rollout, read the sanctioned LightNode status, including `automatic_shutdown`
and `lease_held`. On a persistent LightNode (`automatic_shutdown=disabled`), the
existing `ci-deployer` requires `lease_mode=required` AND `lease_held=true` through
`validated_status`: for status, **before replacement including no-op, and after
replacement**.
This may block the fix deployment while the old Lightsail API still renews the lease.
Moving that API off the lease through an approved administrator stop is then a
precondition for a green LightNode deployment. Do not weaken the persistent lease
check, delete the DB lease row, or force a takeover to get past it. No host state or
administrator recovery was verified or performed by this implementation.

## Controlled handover

1. Confirm the approved DNS-resolved provider, each host's explicit holder, selected
   provider provisioning, release identity, document feature flags and existing
   release/provider-egress approvals. Preserve all current deployment guards.
2. Ensure the nonselected host either runs a **gate-containing release** with the
   correct desired-provider setting through its sanctioned approved deployment path,
   or is stopped through an approved administrator path. New environment plus restart
   of old code is ineffective: old code ignores this setting. The current production
   Lightsail operator requires `SCHEDULERS_ENABLED=true`; setting it false through
   that deploy path is not a recovery option. An administrator stop is outside the
   restricted CI operator interface and requires separate operational authorization.
3. Observe prior lease release or expiry before the selected host takes over. Preserve
   the 90-second TTL, 60-second local grace, 70-second same-holder takeover threshold
   and 20-second renew interval. A stopped old process may leave the row until expiry;
   do not delete it. If the persistent LightNode pre-replacement check blocks, obtain
   the approved administrator recovery above and re-evaluate sanctioned status.
4. Restart/deploy the selected host with the gate-containing release and correct
   environment through the sanctioned path. Both active production CI jobs require a
   bounded TLS fetch of the public `/health/lease`: strict JSON must name the
   DNS-resolved provider and report `eligible=true`, required mode and matching holder.
   `held=true` is not required by this public adoption check during bounded handover;
   the persistent LightNode host check still independently requires it. A CI refusal
   requires configuration/release diagnosis; it does not provision the missing env.
5. Observe eventual selected-holder lease renewal, nonselected `eligible=false` and
   `held=false` (or stopped), and document queue progress with existing feature flags.
   `/health/lease` reports the local process's recent ownership under its renewal/grace
   rules. A green provider verifier alone does not establish held ownership or job
   completion. An aggregate completed-job count does not identify which host ran an
   individual job, and DB completed status alone does not verify provider delivery.
   Do not label local/mock tests or eligible status as proof of remote document sending.

The original code unit's local regression checks did not prove direct Lightsail
`eligible=false/held=false`, the host identity behind historical job completions,
or actual eFormsign delivery. The separately dated SSH observation below adds direct
Lightsail health evidence; it does not establish queued-job completion, host
configuration changes, provider delivery, or an automatic failback guarantee.

The public owner verifier is not used for manual non-owner deployment or passive
standby. Those retain their own status contracts. A passive host's mismatch is expected.

## Rollback

Retain a known gate-containing release and both hosts' approved provider settings.
Switching providers requires the same provisioning, old-owner quiescence, lease
handover and sanctioned deployment gates in the reverse direction. Rolling a host back
to pre-gate code discards provider enforcement; it must remain stopped unless a
separately approved recovery establishes safe ownership. A verifier failure does not
itself stop an old owner or prove the new owner has acquired the lease. No automatic
rollback, production merge, deployment, remote restart or DB mutation is part of this unit.


## SSH로 Lightsail 상태를 읽는 절차 — failback HOLD 유지

이 절차는 이미 승인된 인스턴스와 SSH 별칭의 **health 읽기 전용 조회**에만 적용한다.
공유 Lightsail 운영 runbook의 인증·권한·변경 승인 경계는 그대로 유지한다. AWS CLI와
SSH 인증이 유효해야 하며, 암호/MFA 입력은 사용자가 직접 처리한다. 인증 실패 시
중단하고 자격 증명 파일·로그인 캐시·개인 키를 읽거나 다른 IAM 주체로 우회하지 않는다.
방화벽 변경 없이 현재 허용된 SSH 경로를 사용한다. 접속이 막히면 이 절차를 중단한다.

먼저 알려진 `babyjamjam-admin-server` 인스턴스와 `agent-lightsail-operator` SSH
별칭의 연결 근거를 대조한다. 아래 사전 확인은 프로필·리전을 고정하고 STS 계정과
인스턴스 ARN의 계정을 메모리에서 비교한다. SSH 별칭의 실제 대상도 현재 인스턴스와
일치해야 한다. 출력은 판정만 남기며 계정 ID, ARN, 주소와 명령의 원문 오류를 출력하지
않는다. `set -x` 등 명령 추적은 끈 상태에서 실행한다. 일치하지 않으면 추측해 고치지 않는다.

```bash
python3 - <<'PY'
import json
import subprocess
import sys


def run(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=15)
    if result.returncode:
        raise ValueError("command_failed")
    return result.stdout


try:
    aws = ["aws", "--profile", "agent-lightsail-operator",
           "--region", "ap-northeast-2"]
    caller = json.loads(run(aws + ["sts", "get-caller-identity", "--output", "json"]))
    account = caller["Account"]
    arn = caller["Arn"]
    if not (isinstance(account, str) and account.isascii() and account.isdigit()
            and len(account) == 12 and isinstance(arn, str)
            and arn == "arn:aws:iam::" + account + ":user/agent-lightsail-operator"):
        raise ValueError("iam_operator_mismatch")
    instance = json.loads(run(aws + ["lightsail", "get-instance", "--instance-name",
                                    "babyjamjam-admin-server", "--output", "json"]))["instance"]
    config = dict(line.split(None, 1) for line in run([
        "ssh", "-G", "-o", "ClearAllForwardings=yes", "-o", "RequestTTY=no",
        "agent-lightsail-operator"]).splitlines() if " " in line)
    valid = (instance["arn"].split(":")[4] == account
             and instance["name"] == "babyjamjam-admin-server"
             and config.get("user") == "agent-lightsail-operator"
             and config.get("hostname") == instance["publicIpAddress"])
except Exception:
    valid = False
print("INSTANCE_SSH_IDENTITY_MATCH" if valid else "IDENTITY_UNVERIFIED_STOP")
sys.exit(0 if valid else 2)
PY
```

다음 명령은 실제 SSH 대상 호스트 안에서 Python 3과 `ip -j neigh`를 사용한다.
현재 커널 neighbor에 있는 `docker*`/`br-*` 인터페이스의 private IPv4 항목만 후보로
삼으며 최대 4개, 이미 확인된 backend 포트 `3001`만 조회한다. CIDR 스캔, 추정 IP,
고정된 과거 컨테이너 주소, 환경 파일·로그 읽기는 사용하지 않는다. 주소는 저장하거나
출력하지 않는다. HTTP는 그 SSH 호스트 내부 private bridge에서만 발생한다.
공인 HTTP 개방이나 TLS 검증 우회가 아니며 sudo, Docker socket, 보호된 operator,
SSH forwarding, tunnel을 사용하지 않는다.

`discovery`는 후보 탐색 결과이고 `validation`은 선택된 backend의 응답 검증 결과다.
다른 neighbor의 무응답·비 HTTP 응답과 다른 holder는 주소 없이 `skipped` 범주/개수로만
남긴다. 응답하는 production holder `lightsail` 후보가 정확히 하나여야 하며 그 대상의
lease를 다시 읽고 ready 200까지 확인한다. 빈 목록, 후보 초과, 일치 대상 0개/중복,
잘못된 JSON/타입/mode, 선택 대상의 시간 초과·비 200·비정상 ready는 `inconclusive`다.
같은 프로세스가 여러 인터페이스에 보일 수 있어도 첫 응답을 골라 완료로 처리하지 않는다.
이 탐색은 모든 neighbor나 숨겨진 프로세스가 없다는 증명이 아니다. 아래에서 지원하는
reason은 `provider_not_configured`와 `provider_match`이며 다른 reason은 별도 진단 대상으로 남긴다.

```bash
(
if validated=$(
  set -o pipefail
  {
    ssh -o ClearAllForwardings=yes -o RequestTTY=no -o BatchMode=yes \
      -o ConnectTimeout=10 agent-lightsail-operator 'python3 -' 2>/dev/null <<'PY'
import grp
import ipaddress
import json
import os
import pwd
import re
import signal
import subprocess
import sys
import urllib.error
import urllib.request


class Deadline(BaseException):
    pass


class ProbeError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ProbeError("invalid_json")
        result[key] = value
    return result


def alarm(*_):
    raise Deadline()


def get(address, path):
    try:
        # No environment-derived HTTP proxy and no redirect to another target.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open("http://" + address + ":3001" + path, timeout=3) as response:
            body = response.read(4097)
            if response.status != 200 or len(body) > 4096:
                raise ProbeError("http_or_size")
            return body
    except ProbeError:
        raise
    except urllib.error.HTTPError:
        raise ProbeError("http_non200") from None
    except Exception:
        raise ProbeError("unresponsive") from None


def read_lease(address):
    try:
        lease = json.loads(get(address, "/health/lease"), object_pairs_hook=unique_object)
    except (ValueError, UnicodeError):
        raise ProbeError("invalid_json") from None
    if not isinstance(lease, dict) or not isinstance(lease.get("holderId"), str):
        raise ProbeError("invalid_lease")
    return lease


def validate_lease(lease):
    keys = {"mode", "holderId", "held", "provider", "eligible", "eligibilityReason"}
    if (set(lease) != keys or lease["mode"] != "required" or lease["holderId"] != "lightsail"
            or type(lease["held"]) is not bool or type(lease["eligible"]) is not bool
            or lease["provider"] not in (None, "lightnode", "lightsail")
            or lease["eligibilityReason"] not in ("provider_not_configured", "provider_match")):
        raise ProbeError("invalid_lease")
    if ((lease["eligibilityReason"] == "provider_not_configured"
         and (lease["provider"] is not None or lease["eligible"]))
            or (lease["eligibilityReason"] == "provider_match"
                and (lease["provider"] != "lightsail" or not lease["eligible"]))):
        raise ProbeError("inconsistent_lease")


def main():
    result = {"discovery": "inconclusive", "validation": "inconclusive"}
    try:
        uid = os.geteuid()
        if (uid != 1001 or pwd.getpwuid(uid).pw_name != "agent-lightsail-operator"
                or any(grp.getgrgid(g).gr_name == "docker" for g in set(os.getgroups()) | {os.getegid()})):
            raise ProbeError("privilege_mismatch")
        signal.signal(signal.SIGALRM, alarm)
        signal.alarm(35)  # Overall bound, including response-body reads.
        neighbors = subprocess.run(["ip", "-j", "neigh", "show"], capture_output=True,
                                   timeout=3, check=True)
        if len(neighbors.stdout) > 262144:
            raise ProbeError("neighbor_output_too_large")
        entries = json.loads(neighbors.stdout, object_pairs_hook=unique_object)
        if not isinstance(entries, list):
            raise ProbeError("invalid_neighbors")
        candidates = set()
        for entry in entries:
            dev = entry.get("dev", "")
            if not isinstance(dev, str) or not re.fullmatch(r"docker[\w.-]*|br-[\w.-]+", dev):
                continue
            try:
                address = ipaddress.IPv4Address(entry.get("dst", ""))
            except ipaddress.AddressValueError:
                continue
            if (address.is_private and not address.is_loopback and not address.is_link_local
                    and not address.is_multicast and not address.is_unspecified
                    and not address.is_reserved):
                candidates.add((dev, str(address)))
        result["candidate_count"] = len(candidates)
        if not 1 <= len(candidates) <= 4:
            raise ProbeError("neighbor_count_out_of_bounds")
        result["discovery"] = "complete"
        matches, skipped = [], {"unresponsive": 0, "http_non200": 0, "non_production_holder": 0}
        for _, address in sorted(candidates):
            try:
                lease = read_lease(address)
            except ProbeError as error:
                if str(error) not in ("unresponsive", "http_non200"):
                    raise
                skipped[str(error)] += 1
                continue
            if lease["holderId"] != "lightsail":
                skipped["non_production_holder"] += 1
                continue
            validate_lease(lease)
            matches.append(address)
        result.update(matching_endpoints=len(matches), skipped=skipped)
        if len(matches) != 1:
            raise ProbeError("production_match_count")
        # A discovered match is selected only after checking every candidate.
        # Re-read that endpoint: timeout/non200/invalid lease is now a validation failure.
        lease = read_lease(matches[0])
        validate_lease(lease)
        get(matches[0], "/health/ready")
        result["observed"] = {**lease, "ready_http": 200}  # Whitelist, never raw body.
        result["validation"] = "valid"
        blocked = not lease["held"] and not lease["eligible"]
        result["hold_nonowner_observed"] = blocked
        print(json.dumps(result))
        return 0 if blocked else 2
    except Deadline:
        result["reason"] = "overall_deadline"
    except ProbeError as error:
        result["reason"] = str(error)
    except Exception:
        result["reason"] = "local_validation_failed"
    finally:
        signal.alarm(0)
    print(json.dumps(result))
    return 2


sys.exit(main())
PY
  } | python3 -c '
import json
import sys


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate_key")
        result[key] = value
    return result


try:
    raw = sys.stdin.buffer.read(16385)
    if not raw or len(raw) > 16384:
        raise ValueError("invalid_size")
    result = json.loads(raw, object_pairs_hook=unique_object)
    expected = {"discovery", "validation", "candidate_count", "matching_endpoints",
                "skipped", "observed", "hold_nonowner_observed"}
    if (not isinstance(result, dict) or set(result) != expected
            or result["discovery"] != "complete" or result["validation"] != "valid"
            or type(result["hold_nonowner_observed"]) is not bool
            or result["hold_nonowner_observed"] is not True
            or type(result["candidate_count"]) is not int
            or not 1 <= result["candidate_count"] <= 4
            or type(result["matching_endpoints"]) is not int
            or result["matching_endpoints"] != 1):
        raise ValueError("invalid_result")
    skipped = result["skipped"]
    if (not isinstance(skipped, dict)
            or set(skipped) != {"unresponsive", "http_non200", "non_production_holder"}
            or any(type(value) is not int or not 0 <= value <= 3 for value in skipped.values())
            or sum(skipped.values()) != result["candidate_count"] - 1):
        raise ValueError("invalid_discovery")
    observed = result["observed"]
    if (not isinstance(observed, dict)
            or set(observed) != {"mode", "holderId", "held", "provider", "eligible",
                                 "eligibilityReason", "ready_http"}
            or observed["mode"] != "required" or observed["holderId"] != "lightsail"
            or type(observed["held"]) is not bool or observed["held"] is not False
            or type(observed["eligible"]) is not bool or observed["eligible"] is not False
            or observed["provider"] is not None
            or observed["eligibilityReason"] != "provider_not_configured"
            or type(observed["ready_http"]) is not int or observed["ready_http"] != 200):
        raise ValueError("invalid_observation")
except Exception:
    sys.exit(2)
# Re-serialize only the exact validated schema; do not echo remote stdout/errors.
print(json.dumps(result))
' 2>/dev/null
); then
  printf '%s\n' "$validated"
  printf '%s\n' '단일 backend의 ready와 HOLD 비소유 상태를 관측했습니다. failback 승인은 아닙니다.'
else
  printf '%s\n' '{"validation":"inconclusive","reason":"ssh_or_result_unverified"}'
  exit 2
fi
)
```

SSH 오류 원문에는 주소가 포함될 수 있어 화면 출력을 막았다. SSH stdout은 고정된
로컬 Python 검증기에 stdin으로 전달하며 shell 코드에 보간하거나 eval하지 않는다.
바깥 Bash도 pipefail과 엄격한 JSON shape/타입/값 검증을 통과한 결과만 출력한다.
빈 값·비 JSON·불일치 결과·SSH 비정상 종료는 원문 없이 `inconclusive`와 종료값 2로
끝나며 성공 문구를 출력하지 않는다. 반환된 `ready_http=200`은 API 준비 상태이고 `eligible`은
provider 설정상 참가 자격, `held`는 해당 프로세스의 최근 lease 소유 관측이다.
`validation=valid`라도 `held=true` 또는 `eligible=true`이면 HOLD 비소유 확인이 아니므로
중단하고 진단한다. `held=false/eligible=false` 자체도 모든 host cron/timer의 정지나
외부 문서 전달을 증명하지 않는다. LightNode의 공개 HTTPS health와 기존 승인된
읽기 전용 DB 소스의 `background-owner` 관측을 별도로 비교한다. 새 DB 접근·SQL 비밀값
취득·lease 행 삭제/수정으로 확인을 우회하지 않는다.

### 2026-11-04 18:14 KST 관측 기록

아래는 당시의 별도 읽기 전용 조사 결과이며 미래 상태의 보장이 아니다. SSH 별칭은
실제 AWS 인스턴스와 일치했고 Linux uid `1001`, Docker 그룹 미가입이었다. Docker는
active, node 프로세스 1개, caddy 0개가 관측됐다. `ss`에서 22/53만 보인 사실만으로
Docker DNAT 게시 포트가 없다고 결론낼 수 없다. 공개 방화벽은 제한된 SSH 22만 허용했고
호스트 loopback의 TLS 443 연결은 실패했다. 이 public/host TLS 실패만으로 backend가
내려갔다고 판단하지 않았다.

현재 커널 Docker bridge neighbor 2개를 최대 4개 제한 안에서 조사했으며, 그중 한
대상에서 내부 포트 3001 health 응답을 얻었다. 다른 후보의 탐색은 시간 초과였다.
단일 backend 관측을 모든 neighbor의 검증이나 숨겨진 프로세스 부재로 확대하지 않는다.
당시 상태는 다음과 같다.

| 근거 | 당시 관측 | 해석 범위 |
| --- | --- | --- |
| Lightsail SSH 내부 HTTP | ready 200; mode `required`, holder `lightsail`, held `false`, provider `null`, eligible `false`, reason `provider_not_configured` | 관측한 backend의 API 준비와 provider 비소유 상태. 모든 프로세스 검증은 아님 |
| LightNode 공개 HTTPS | ready 200; mode `required`, holder `lightnode`, held `true`, provider `lightnode`, eligible `true`, reason `provider_match` | 당시 공개 API가 보고한 최근 소유 상태 |
| 기존 읽기 전용 DB 소스, 18:14:54 KST | `background-owner` holder `lightnode`, 미만료, 갱신 약 0.44초 전 | 당시 공유 lease 행의 소유 근거. 개별 작업 실행 호스트·완료·전달 근거는 아님 |

provider `null`은 당시 보고값이지 앞으로 유지해야 할 목표 설정이 아니다.
**Lightsail failback은 계속 HOLD**다. Provider 변경, failback, 배포, restart 및 방화벽
변경은 별도 승인 대상이며 이번 관측에서는 수행하지 않았다. 이 조회 절차는 새로운
control plane이나 자동 handover 기능을 만들지 않는다.

### Lightsail 비용은 0원이 아님

2026-11-04 서울 리전의 읽기 전용 인스턴스/번들 조회에서 인스턴스는 `running`,
번들은 `medium_3_0` Linux/Unix, RAM 4GB·2 CPU·SSD 80GB였고
`get-bundles`의 기본 표시 가격은 **USD 24/월**이었다. 이는 날짜를 붙인 번들 기본요금
조회이며 계정의 실제 청구액·사용 명세서 검증이 아니다. 세금, 크레딧, 다른 리소스,
추가 전송량과 snapshot 비용 등은 이 수치에 포함해 산정하지 않았다.
[AWS 공식 가격표](https://aws.amazon.com/lightsail/pricing/)와
[AWS FAQ의 청구 설명](https://aws.amazon.com/lightsail/faq/)에 따르면 일반적인
Lightsail 인스턴스는 **실행 중이거나 중지된 동안에도 과금**된다. `held=false`나
failback HOLD는 인스턴스를 중지하거나 요금을 없애는 동작이 아니다. 비용 0원을
주장하지 않으며 중지·삭제는 이 문서 단위의 범위 밖이고 수행하지 않았다.
