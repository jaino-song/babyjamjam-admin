# GitHub-to-Lightsail backend deployment

Pushes to `preview` and `main` build the backend image on GitHub-hosted runners.
The workflow publishes an immutable commit image to the public GHCR package and
asks AWS Systems Manager to activate that exact image on the existing Lightsail
host. The host does not build application images.

| Branch | Deployment credential | Runtime | Approval |
|---|---|---|---|
| `preview` | branch-scoped preview role | preview backend | automatic after CI |
| `main` | branch-scoped production role | production backend | `production` environment required reviewer |

The deploy and fixed-purpose operations jobs receive temporary AWS credentials through GitHub OIDC. Their
trust policy pins preview access to `refs/heads/preview` and production access
to `refs/heads/main`; a feature branch cannot gain deployment authority by
referencing an environment. Production approval runs in a separate
`production` environment job that has no AWS token, and the branch-scoped
deployment job starts only after that approval succeeds. The workflow does not
use an AWS access key, SSH key, or a remotely supplied shell command. The
preview and production roles can each invoke only their fixed SSM document on a
managed node with the configured `DeploymentTarget` tag. The workflow refuses
to send a command unless that tag resolves to exactly one online managed node.

## Local operations CLI

The local CLI deliberately uses the authenticated GitHub CLI instead of local
AWS credentials. GitHub Actions obtains short-lived, branch-scoped credentials
through OIDC and invokes only the fixed SSM documents declared in
`github-oidc-ssm.yaml`.

```bash
backend/deploy/lightsail/lightsail-cli.sh status preview
backend/deploy/lightsail/lightsail-cli.sh deploy preview
backend/deploy/lightsail/lightsail-cli.sh status production
backend/deploy/lightsail/lightsail-cli.sh deploy production
backend/deploy/lightsail/lightsail-cli.sh operator-upgrade
backend/deploy/lightsail/lightsail-cli.sh node-status production
backend/deploy/lightsail/lightsail-cli.sh standby
backend/deploy/lightsail/lightsail-cli.sh status production --self
backend/deploy/lightsail/lightsail-cli.sh deploy production --self
```

The last four exist for the cold standby host (BJJ-605):

- `node-status` asks Systems Manager for the nodes carrying the configured tag
  and prints the total count, the online count, and each node's ping status,
  last ping time and agent version. It succeeds only when exactly one node is
  registered and online. It sends no command to the host and uses no SSM
  document.
- `standby` stops the production API container on the host and then the preview
  one, re-lists after each stop, and fails if a container is still running. If
  it fails part-way, check both environments. It is meant to leave the API
  stopped across a reboot, a snapshot and a restore; that has been read from
  the Docker documentation and has yet to be verified on the host. A later
  `deploy`, an administrator-run rollback, or `db-reconcile` can create the API
  again. The workflow refuses `standby` unless production DNS currently points
  at LightNode.
- `--self` makes `status` and `deploy` verify this host from the inside
  (container state, image identity, scheduler configuration, database route
  agreement, in-container readiness) and skip the public hostname. The output
  then carries `public_health=skipped`, `health_scope=self` and two reported
  fields, `edge_route` and `edge_tls`, from a probe of the host's own Caddy on
  the loopback address. The workflow shows a warning when either is not `ok`
  and does not fail on them. `--self` is production-only.
- Without `--self`, `status` and `deploy` also require the public hostname to
  answer, and cannot tell which server answered. Do not run `deploy production`
  without `--self` against a standby host while production DNS points at
  LightNode: it passes on LightNode's answer and leaves the Lightsail API
  running.
- A deploy that fails before activation (image validation, migration) leaves
  the containers untouched. After that point the operator attempts recovery:
  if the API was stopped when the deploy started, it stops the new API and
  restores the release records without starting the previous image; if the API
  was running, it rolls back to the image that was running. Recovery can itself
  fail, and a workflow check that fails after the host command succeeded runs
  no recovery, so confirm the actual API state before the next step. Applied
  database changes stay.

`standby` and `--self` use three more SSM documents, so they work only after
the stack is updated, the three variables below are set, and the host operator
has been upgraded from a `main` commit that contains this change.

The command watches the workflow run and returns its exit status. Add
`--no-watch` to open the run without waiting. Production operations enter the
`production` GitHub environment approval gate. The root operator bundle is
shared by Preview and Production, so `operator-upgrade` is always pinned to the
current `main` commit and uses the same Production approval gate; no
Preview-only upgrade exists. The workflow does not accept arbitrary shell text,
document names, commit SHAs, image digests, roles, regions, or node targets from
the local caller.

Diagnostics access is a separate account-owned boundary. The
`AgentLightsailDiagnosticsPolicy` CloudFormation resource is deliberately
unattached; it is not granted to either GitHub OIDC deployment role and it does
not change ownership of the existing `agent-lightsail-operator` IAM user. The
policy allows only the four existing SSM read actions
(`DescribeInstanceInformation`, `GetCommandInvocation`, `ListCommandInvocations`,
and `ListCommands`) in `ap-northeast-2`, plus `SendCommand` for the fixed
`PreviewDiagnosticsDocument` and `ProductionDiagnosticsDocument` on the single
managed node tagged `DeploymentTarget=babyjamjam-admin-server`. It grants no
`AWS-RunShellScript`, `StartSession`, arbitrary document, shell, path, or
deployment access.

## One-time activation checklist

Every step below changes external state and requires the Lightsail operational
approval gate before execution.

1. Confirm or create the AWS IAM OIDC provider for
   `https://token.actions.githubusercontent.com` with audience
   `sts.amazonaws.com`. Reuse an existing provider rather than creating a
   duplicate.
2. Deploy `github-oidc-ssm.yaml` in `ap-northeast-2`, passing the existing
   provider ARN and the fixed `ManagedNodeTagValue=babyjamjam-admin-server`.
   The template requires `CAPABILITY_NAMED_IAM` for its version-controlled
   managed policy. Keep the CloudFormation stack as the source of truth for
   roles, the shared managed-node tag, SSM documents, and the unattached
   diagnostics policy.
3. Create a short-lived Systems Manager hybrid activation using the stack's
   `ManagedNodeServiceRoleName`. Attach the same `DeploymentTarget` tag, install
   the SSM agent on the Lightsail host, verify exactly one online managed node,
   then expire or delete the activation. Never record the activation code or ID
   in this repository or CI logs.
4. Before installation, migrate `/opt/babyjamjam` and each
   `environments/<environment>` directory to a non-symlink, root-owned,
   group/world-non-writable boundary. Keep each `backend.env` exactly
   `root:root` mode `0600`; the installer and operator fail closed rather than
   silently repairing an unsafe secret boundary. Then install the root-only
   command and its protected artifact bundle and verify their metadata:

   ```bash
   sudo backend/deploy/lightsail/install-ci-operator.sh install
   sudo backend/deploy/lightsail/install-ci-operator.sh check
   ```

   Installation also creates or repairs the shared per-environment lock files
   as `root:root` mode `0600` and transactionally installs the operator,
   deploy helper, rollback helper, and Compose definition under
   `/usr/local/libexec/babyjamjam-ci-operator`. The root CI operator refuses to
   deploy when that bundle, the lock contract, or the root-owned
   environment-file boundary is invalid. `ubuntu` must not belong to the
   Docker group.

5. Publish the first image, connect the GHCR package to this repository, and
   set the package visibility to public. Public visibility is required because
   the host deliberately has no registry credential. Confirm anonymous pull of
   the exact digest before enabling deployment.
6. Create a GitHub environment named exactly `production`, then add a required
   reviewer. This environment is only the approval gate and contains no AWS
   deployment credentials.
7. Add these GitHub repository variables from the matching CloudFormation
   outputs:

   - `AWS_PREVIEW_DEPLOY_ROLE_ARN`
   - `AWS_PREVIEW_DEPLOY_DOCUMENT_NAME`
   - `AWS_PREVIEW_STATUS_DOCUMENT_NAME`
   - `AWS_PRODUCTION_DEPLOY_ROLE_ARN`
   - `AWS_PRODUCTION_DEPLOY_DOCUMENT_NAME`
   - `AWS_PRODUCTION_STATUS_DOCUMENT_NAME`
   - `AWS_OPERATOR_UPGRADE_DOCUMENT_NAME`
   - `AWS_PRODUCTION_SELF_STATUS_DOCUMENT_NAME` (output
     `ProductionSelfStatusDocumentName`)
   - `AWS_PRODUCTION_SELF_DEPLOY_DOCUMENT_NAME` (output
     `ProductionSelfDeployDocumentName`)
   - `AWS_HOST_STANDBY_DOCUMENT_NAME` (output `HostStandbyDocumentName`)
   - `LIGHTSAIL_SSM_TARGET_TAG`

   An operation that sends a host command selects one document variable for
   its environment and health scope. When that variable is empty the workflow
   fails and names it; it never falls back to another document. `node-status`
   uses no document variable. An empty tag or role variable fails earlier,
   without naming the variable.

8. If the external IAM operator needs deployment-failure diagnostics, review the
   `AgentLightsailDiagnosticsPolicyArn` stack output and explicitly attach that
   managed policy to the existing `agent-lightsail-operator` user. The stack does
   not attach it automatically:

   ```bash
   aws iam attach-user-policy \
     --profile <administrator-profile> \
     --user-name agent-lightsail-operator \
     --policy-arn '<AgentLightsailDiagnosticsPolicyArn output>'
   ```

   Verify the attachment and remove any temporary inline read policy only after
   the fixed diagnostics documents return bounded, sanitized output. Detaching
   or replacing an IAM policy is a separate state-changing operation and needs
   its own approval. Do not attach this policy to a GitHub role or a broad IAM
   group as a convenience.

9. Run the workflow manually on a non-deploying branch to validate CI, then
   merge through `dev` to `preview`. Verify image provenance, container health,
   restart count, scheduler ownership, and the public health route. Rehearse a
   rollback in preview before enabling the production environment.

## Release and recovery contract

The workflow waits for type checking, lint, unit tests, migration drift checks,
and auth/agent E2E tests. It then builds `backend/Dockerfile.lightsail`, labels
the image with the source commit, pushes the commit tag, and passes the returned
digest to SSM. Superseded image builds are cancelled; a deployment that has
started is never cancelled by concurrency handling.

The root-only host operator accepts only an environment, a lowercase 40-byte
commit SHA, and a lowercase SHA-256 image digest. It verifies that the commit is
the current tip of the corresponding environment branch and that the pulled
image label matches that commit. Before changing the running container, it runs
`prisma migrate deploy` from that exact image using the target environment's
database configuration. A migration failure leaves the current application
image running. Release migrations must remain backward-compatible because a
successful database migration cannot be automatically undone if later runtime
activation fails. After activation it writes the candidate digest and then runs
the final host verification: one API container, the authoritative route and
exact `DATABASE_CONNECTION_MODE`, scheduler ownership, health/restart, image
tag/digest identity and internal `/health/ready` in both health scopes, plus
public `/health/ready` and public liveness in public scope. Self scope reports
the loopback edge checks instead. If that verification fails, the operator
attempts to restore the earlier release records.

For the first Preview or Production deployment of an image containing
`20261126010000_baby_case_keys`, complete the following steps in order. The
`operator-upgrade` workflow installs only from the current protected `main` tip
and requires production approval. Use the host procedure below for a reviewed
revision that has yet to reach `main`.

1. With Lightsail operational approval, run this from the root of a trusted,
   clean checkout on the deployment host. Set `reviewed_commit` to the full
   commit SHA approved for the operator bundle. Require every command to
   succeed before proceeding. The installer check validates the installed
   manifest and metadata, and the SHA-256 checks tie the installed files to
   the reviewed revision.

   ```bash
   (
     set -euo pipefail
     reviewed_commit='<reviewed full commit SHA>'
     test "$(git rev-parse HEAD)" = "$reviewed_commit"
     checkout_status=$(git status --porcelain)
     test -z "$checkout_status"
     sudo backend/deploy/lightsail/install-ci-operator.sh install --replace
     sudo backend/deploy/lightsail/install-ci-operator.sh check

     while read -r source installed; do
       digest=$(git show "$reviewed_commit:$source" | sha256sum)
       printf '%s  %s\n' "${digest%% *}" "$installed" | sudo /usr/bin/sha256sum --check -
     done <<'BUNDLE_FILES'
   backend/deploy/lightsail/ci-operator.sh /usr/local/sbin/babyjamjam-ci-operator
   backend/deploy/lightsail/ci-operator.sh /usr/local/libexec/babyjamjam-ci-operator/ci-operator.sh
   backend/deploy/lightsail/deploy.sh /usr/local/libexec/babyjamjam-ci-operator/deploy.sh
   backend/deploy/lightsail/rollback.sh /usr/local/libexec/babyjamjam-ci-operator/rollback.sh
   backend/compose.lightsail.yml /usr/local/libexec/babyjamjam-ci-operator/compose.lightsail.yml
   BUNDLE_FILES
   )
   ```

2. On each existing target database, complete the rollout gates and drain all
   old writers that rely on singleton keys. Then explicitly apply
   `backend/prisma/scripts/stage-baby-case-keys.sql` to that database.
3. Promote the reviewed image. The operator uses the image's read-only stage
   check before `prisma migrate deploy`. A populated database with missing or
   incorrect replacement indexes or surviving legacy keys blocks the release.

Before staging, the previous image can continue serving with the legacy keys.
After staging, use only a recovery image that supports case-scoped keys before
resuming writes. Retain the guarded operator while the new image is eligible
for promotion.

If deployment or verification fails on a host whose API was running when the
deploy started, the operator immediately invokes the existing rollback script
with the recorded known-good commit image, preserves the prior rollback-tag
history, restores the prior digest state, and verifies the recovered runtime.
On a host whose API was stopped (standby), it stops the new API and restores
the release records instead. The root CI operator holds one per-environment lock so
concurrent commands cannot change the same runtime. Detailed output is kept in
a root-only host log; GitHub receives only a failure status and safe release
fields. The Backend CI job that used to print a redacted copy of a failed
command's output was removed with the main-push Lightsail deploy (BJJ-598). The
Lightsail operations workflow reports by where it stopped: a configuration,
image-lookup or authentication failure in that workflow step; a registration
problem after printing `managed_nodes` and `online_nodes`; no final status line
when the sent command's invocation is not found on the expected node; only the
final Systems Manager status, without host output, when the host command did
not end in `Success` (which includes a failed check on the host). When the
host command succeeded, the workflow fetches its standard output and checks
it; `status`, `deploy` and `standby` print the output before the checks, and
`operator-upgrade` prints it after confirming its success marker. The fixed
diagnostics documents expose
the host's own bounded failure history when the SSM invocation output is
insufficient; they cannot accept a command or path parameter. The status contract
includes `db_route`, `runtime_route`, and
`db_readiness=ok`; the workflow requires the two routes to match and rejects
any missing or non-`ok` readiness value.

## Disable and roll back the automation

To stop new deployments without changing the running service, disable the
GitHub workflow or remove the branch's OIDC role repository variable. To remove
host execution capability, run:

```bash
sudo backend/deploy/lightsail/install-ci-operator.sh uninstall
```

After confirming there are no active SSM commands, deregister the managed node
detach `AgentLightsailDiagnosticsPolicy` from `agent-lightsail-operator` if it
was attached, and then delete the CloudFormation stack. Detaching the policy is
a separate approved IAM change; CloudFormation cannot delete a managed policy
while it is attached. These steps do not remove the running containers,
environment files, deployment state, GHCR images, or root-only diagnostic logs.
