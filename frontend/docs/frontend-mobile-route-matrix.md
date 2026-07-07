# Frontend + Mobile Route Matrix

Current route inventory captured before the merge. Use this file as the source of truth when consolidating `frontend` and `mobile` into one web app while preserving both UIs.

## Shared Page Routes

These routes exist in both apps and should be treated as the primary merge targets.

- `/`
- `/callback`
- `/forgot-password`
- `/login`
- `/register`
- `/reset-password`
- `/verify-email`
- `/admin`
- `/admin/feedback/[id]`
- `/alimtalk`
- `/all`
- `/chat`
- `/clients`
- `/clients/new`
- `/contracts`
- `/contracts/creation`
- `/dashboard`
- `/employees`
- `/files`
- `/logout`
- `/messages`
- `/messages/system-templates`
- `/messages/system-templates/[templateKey]`
- `/messages/templates`
- `/messages/templates/new`
- `/messages/templates/[id]/edit`
- `/select-branch`
- `/settings`
- `/test`

## Frontend-Only Routes

- `/alimtalk/templates`
- `/clients/filtered`
- `/prices`
- `/settings/general`
- `/settings/voucher-price`
- `/system-admin`

## Mobile-Only Routes

- `/admin/feedback`
- `/employees/new`

## Merge Rules

- Shared routes should move to one route entrypoint in the merged app.
- Phase 1 should keep separate desktop/mobile presentation layers for shared routes.
- Frontend-only and mobile-only routes should remain explicit exceptions until their product intent is reconciled.
- Dynamic routes should not be dropped from screenshot coverage; they require mocked baseline capture.
