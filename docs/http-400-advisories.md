# HTTP 400 advisories

HTTP 400 responses handled by the backend HTTP/Prisma exception filters are
recorded as Sentry `warning` events tagged `feature:http-advisory`.
Grouping uses HTTP method, registered route template and public error code.

Events contain only catalog-derived reasons, allowed field error codes, outcome,
server-generated request UUID, release and environment. Request bodies, raw URLs,
customer/employee identifiers, headers, user scope, breadcrumbs, exceptions and
attachments are excluded. Capture failure does not change the HTTP response.
Legacy errors without a registered code use the generic `REQUEST_INVALID`
reason; raw exception messages are never forwarded.

`EMPLOYEE_ASSIGNMENT_UNAVAILABLE` identifies disabled next-service assignment.
The existing eligibility rules remain unchanged. Availability is disclosed only
after every requested employee passes branch and deletion checks. Mobile's
existing structured-error presenter displays the shared catalog explanation.

## Sentry configuration (verified 2026-09-17)

Project: `babyjamjam-admin`.

- [Repeated advisory alert](https://covenant-labs.sentry.io/monitors/alerts/3999471/):
  production, event/activity captured, all filters: `feature` equals
  `http-advisory`, more than 9 events in an issue over 15 minutes. Notify existing
  member Jaino Studio on their preferred channel, at most once per hour per issue.
- [Existing high-priority alert](https://covenant-labs.sentry.io/monitors/alerts/3745323/):
  added `feature` does not equal `http-advisory`; other triggers/actions unchanged.
- Existing service-record alerts already require `feature` containing
  `service-records`, so they do not match advisories.

Alert configuration is saved, but new event ingestion requires deployment of
this branch. No production customer mutation or test notification was performed.
To roll back, revert the code change, disable the new alert and remove only the
`http-advisory` exclusion from the existing high-priority alert.
