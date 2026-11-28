# Preview outbound delivery

Before deploying Preview, create Secret Manager secrets named
`SMS_RECIPIENT_ALLOWLIST` and `EMAIL_RECIPIENT_ALLOWLIST`. Add enabled versions
and grant the Preview runtime service account access. Enter only approved QA
contacts in the comma-separated lists. The manifest uses the latest version of
each secret. Deploy a new Preview revision after changing either list so new
instances receive the intended values.

Preview enforces both lists and blocks all recipients on a channel if its list
has no entries. An explicit list also restricts its channel in other
environments. Keep the list variables unset wherever the existing unrestricted
delivery behaviour is needed. The empty placeholders in the env templates
describe the keys and would restrict delivery if copied into a runtime env file.

If a list is wrong, restore the previous approved value as a new secret
version and redeploy. For an emergency rollback, stop Preview traffic before
restoring a revision that predates allowlist enforcement.
