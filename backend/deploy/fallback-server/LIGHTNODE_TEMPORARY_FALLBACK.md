# LightNode temporary Fallback host

This is a manual 24–48 hour operation, not automatic Sentry/controller failover. Select **Korea VPS Agency**, Linux x86_64, shared 2 vCPU/4 GB/50 GB NVMe. Do not select Start; do not select dedicated VDS without separate approval. Confirm the console hourly/all-in quote before purchase.

Create fresh Ubuntu with SSH keys only, restrictive cloud firewall/security group, Docker/Compose, Node, systemd and Tailscale. Never place production secrets in images, cloud-init, CLI arguments, console logs, or shell history. Run `lightnode-preflight.sh fresh`, then use a separately approved root-only provisioning channel to install the protected bundle. Run `lightnode-preflight.sh installed` only while that bundle is staged: before any environment file, approval, evidence, passive deployment, or active runtime. After deployment use the Fallback operator `status`, not preflight. The operator validates and consumes root-owned artifacts; it never receives their values in arguments or stdout.

Deploy an immutable tag+digest passive first. Hash current VPS egress from two sources, complete Aligo allow-list and the exact no-send synthetic fixture procedure, then use expiry-bound `temporary-active`. The fixture must use the pre-approved synthetic recipient and assert provider authentication without sending a message or document; it must not be substituted with a live recipient. Real Aligo or eFormsign provider-acceptance delivery is separately approved with its exact recipient, document, and rollback record. Preserve the public API contract: capture the existing `api.babyjamjam.com` A record as a protected rollback artifact, terminate TLS on Caddy bound only to the VPS public interface, and reverse-proxy to loopback `127.0.0.1:3101`. Patch the single preflight-captured DNS record only after passive health and read it back after the write. Tailscale Funnel is allowed only for pre-cutover validation and must be off after the stable API hostname is healthy. Never expose the controller. Keep both Production frontends on `https://api.babyjamjam.com`; AWS failback then requires only the separately approved reverse DNS patch.

For continued operation, issue a fresh bounded approval and run `extend-temporary-active` before expiry. Extension must preserve the running API container ID and scheduler ownership; stop/restart renewal is forbidden. Each approval remains limited to 48 hours even when successive extensions keep the incident active until manual AWS failback.

For a release replacement while LightNode remains the active production owner,
issue a fresh bounded approval for the new immutable tag and digest, then run
`replace-temporary-active`. The operator preloads and verifies the new image
while the old API remains healthy and limits user-visible interruption to the
final Compose API recreate plus readiness wait, matching the Lightsail deploy
ordering. It automatically restores the previous active image and its original
expiry/linkage if the new runtime fails. This is a minimal-downtime single-slot
replacement, not blue-green; scheduler and document-worker ownership must never
be duplicated on another host during the operation.

Approval checkpoints are separate: purchase; host/firewall provisioning; Aligo allow-list; active artifact; stable API DNS/TLS cutover; controlled no-send synthetic smoke; rollback; irreversible Release. None is authorized by this document.

Conditional `main` CI replacement is a separate opt-in authority. It may be
installed only after the dedicated non-Docker SSH user, root-owned automation
authority, protected LightNode routing hash, Tailscale ACL, and GitHub secrets
have been approved. CI must resolve one exclusive production target: when the
route hash is LightNode it may call only the restricted CI wrapper; when the
route hash is Lightsail it may call only the existing SSM deployment; an unknown
or mixed hash deploys nowhere. The wrapper must preserve the bounded approval,
singleton scheduler/document-worker ownership, preload-before-recreate order,
and automatic rollback contract of `replace-temporary-active`.

For failback, verify AWS health and reconciliation, restore the protected `api.babyjamjam.com` DNS value, and confirm public HTTPS on AWS before stopping Fallback. Then revoke the LightNode Aligo egress, disable Caddy, revoke Tailscale device/auth material, stop and confirm API absence, scrub, **Release** (not Stop), and confirm billing ended. Never image a host after runtime secrets or a production container existed: Docker Config.Env/deleted-block history can retain them. Golden images are allowed only before secret injection; otherwise Release without imaging. A recreated instance/public IP requires new Aligo registration and approval hash.

## Explicit no-automatic-shutdown operation

The production operator may explicitly prohibit automatic shutdown. Record that
policy in `/opt/babyjamjam-fallback-server/automatic-shutdown-policy`, a regular
non-symlink `root:root` mode `0400` file containing exactly `disabled` and a newline.
This is a host policy, not a caller environment variable. All four
`babyjamjam-fallback-temporary-active-{guard,stop}.{service,timer}` units must
remain masked to `/dev/null` and inactive. The installer preserves those masks;
neither release replacement nor rollback schedules an expiry stop. The API
uses `unless-stopped` so a host restart does not leave the public route down.

After an approved recovery has restarted an existing API but expiry cleanup
removed its active state, run `babyjamjam-fallback-server adopt-persistent-active`
through the existing administrator provisioning channel. It verifies the unique
running release, healthy API, Production DB identity, active gates, scheduler
lease, protected original approval/evidence and approved egress, then restores
state from those existing artifacts without restarting the API. It cannot start
a stopped service or invent approval/evidence values.

Status reports `automatic_shutdown=disabled`. The restricted CI interface stays
`status`/`replace`; each replacement still requires automation authority, public
routing identity, a fresh release-bound transaction approval, immutable image
verification, readiness and automatic image rollback. Historical approval expiry
does not stop the persistent runtime. Missing policy retains the original
expiry-bound behavior; malformed policy or unmasked shutdown units refuse deployment.
Do not restore timers as a deployment repair for a host with this policy.
