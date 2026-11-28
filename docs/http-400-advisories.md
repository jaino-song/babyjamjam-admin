# HTTP 4xx advisories

This file keeps its original name; it now covers every reported 4xx status,
not only 400. The extension takes effect when the change is deployed to a
runtime that has `SENTRY_DSN`; it does not start on a calendar date.

HTTP 4xx responses handled by the backend catch-all exception filter are
recorded as Sentry `warning` events tagged `feature:http-advisory`. A refused
business or policy request (for example a customer update refused with 409
`CLIENT_PHONE_ALREADY_REGISTERED`) therefore appears as a Sentry issue.
Grouping uses HTTP method, registered route template, status and public error
code.

What is reported:

- Every status from 400 to 499 except 401. A 401 is session expiry or a failed
  sign-in and is never reported.
- A 404 for a URL that matches no registered route is not reported (scanner
  traffic). A 404 thrown by a matched route is reported.
- The Prisma exception filter still reports only its 400 responses as
  advisories. Prisma 404 and 409 keep their existing `error`-level capture
  (`feature:database-failover`, `db.failover_eligible:false`).
- Status 500 and above are not advisories; they keep the `error`-level
  capture described in `error-management.md`.

Volume cap: at most 30 advisories per group (method, route template, status,
code) per 5-minute window, per backend process, which is about 8,640 events
per group per day. Further events in that window are dropped and logged once
as a `HttpAdvisory` warning. The process tracks at most 1,000 groups at a
time; when all 1,000 are inside their window, an event for a new group is
dropped without a log line. The event count of a busy issue can therefore be
lower than the real number of rejections.

The cap limits the rate per group. It does not bound the total: a caller that
produces several groups (for example malformed JSON bodies sent with POST, PUT,
PATCH and DELETE, each reported as route `<unmatched>`) still produces 30
events per group per window. The cap alone therefore does not protect the
Sentry error quota that 5xx capture shares; that depends on Sentry-side rate
limits or spike protection, which have not been verified for this project.

Events contain only catalog-derived reasons, allowed field error codes, outcome,
server-generated request UUID, release and environment. Request bodies, raw URLs,
customer/employee identifiers, headers, user scope, breadcrumbs, exceptions and
attachments are excluded. Capture failure does not change the HTTP response.
Legacy errors without a registered code use the generic catalog code for their
status (`REQUEST_INVALID`, `ACCESS_DENIED`, `RESOURCE_NOT_FOUND`,
`REQUEST_CONFLICT`, `VALIDATION_FAILED`, `REQUEST_RATE_LIMITED` and so on); raw
exception messages are never forwarded. Such an issue names the route and
status but not the specific business reason; register a catalog code for the
rejection to make the reason visible.

`EMPLOYEE_ASSIGNMENT_UNAVAILABLE` identifies disabled next-service assignment.
The existing eligibility rules remain unchanged. Availability is disclosed only
after every requested employee passes branch and deletion checks. Mobile's
existing structured-error presenter displays the shared catalog explanation.

## Sentry configuration (verified 2026-09-17, extended 2026-11-28)

Project: `babyjamjam-admin`.

- [New advisory issue alert](https://covenant-labs.sentry.io/monitors/alerts/6420109/)
  (added 2026-11-28): production, a new, regressed or reappeared issue whose
  `feature` equals `http-advisory`. Emails the project owner. This is what
  turns a first policy rejection of a given kind into a notification, unless
  that event was dropped by the volume cap above.
- [Repeated advisory alert](https://covenant-labs.sentry.io/monitors/alerts/3999471/):
  production, event/activity captured, all filters: `feature` equals
  `http-advisory`, more than 9 events in an issue over 15 minutes. Notify existing
  member Jaino Studio on their preferred channel, at most once per hour per issue.
- [Existing high-priority alert](https://covenant-labs.sentry.io/monitors/alerts/3745323/):
  added `feature` does not equal `http-advisory`; other triggers/actions unchanged.
- Existing service-record alerts already require `feature` containing
  `service-records`, so they do not match advisories.

No event reaches Sentry from a runtime whose `SENTRY_DSN` is unset. The
backend takes the event environment from `SENTRY_ENVIRONMENT`, falling back to
`RAILWAY_ENVIRONMENT_NAME`: `production` and `preview` pass through and any
other value, or none, becomes `dev`. The production alerts above match only
events tagged `production`. This change adds the status to the grouping, so a
400 advisory issue created by an earlier build is not continued by events from
a build that includes it.
To roll back the 4xx extension, revert the code change and disable the new
advisory issue alert. To roll back advisories entirely, also disable the
repeated advisory alert and remove only the `http-advisory` exclusion from the
existing high-priority alert.
