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

Local regression checks in this follow-up do not prove direct Lightsail
`eligible=false/held=false`, the host identity behind historical job completions,
or actual eFormsign delivery. No direct Lightsail verification, queued-job completion,
host configuration change, or automatic failback guarantee is established here.

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
