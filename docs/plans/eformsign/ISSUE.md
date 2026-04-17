# [Feature] Two-phase contract support for 서비스제공기록지 (deferred submission)

## Summary

서비스제공기록지 (service provision records) are 10–30 day daily-record documents. Currently, when the customer signs them in eformsign the backend immediately completes the document (status `050`) and activates the client. This prevents the intended workflow: records must accumulate daily over the period and only then should the document be considered complete.

This issue tracks adding **two-phase contract support** in the backend:

- **Phase 1 — Customer signing (계약 체결)**: unchanged customer experience. The customer signs, the existing `LinkDocumentToClientUsecase` and `sendContractSignedAlimtalk` chain runs as today. The only difference is the backend writes `statusType = "070"` (NEW: 일일기록 수집 중) instead of `050`, keeping the document open for Phase 2.
- **Phase 2 — Service provision records (서비스 제공 기록)**: employees submit daily entries via new backend endpoints. When all entries are filled (or force-finalized with missing dates in the response), the backend flips `statusType = "050"` and sets `finalizedAt`. No customer alimtalk at Phase 2.

The employee frontend (mobile app) is a separate future project; endpoints will be ready when it arrives.

## Architecture Decision: A2 (babyjamjam-staff handles deferral)

eformsign signing is unchanged. Deferral is purely backend state-machine + new endpoints. No new eformsign API calls. No new env vars. No new alimtalk templates.

## Acceptance Criteria

- [ ] Signing a 서비스제공기록지 produces `eformsign_doc.statusType = "070"` with `collectionStartDate`, `collectionEndDate`, `collectionPeriodDays` populated
- [ ] Phase 1 chain (link to client + contract-signed alimtalk) runs unchanged
- [ ] Non-record documents continue to complete at `statusType = "050"` with no behavioral change
- [ ] `POST /daily-records/:docId/entries` accepts daily entries; rejects out-of-range dates (`400`) and duplicates (`409`)
- [ ] `GET /daily-records/:docId/entries` returns entries + computed `missingDates: string[]`
- [ ] `POST /daily-records/:docId/finalize` with `{ force: false }` rejects with missing-dates payload if gaps exist
- [ ] `POST /daily-records/:docId/finalize` with `{ force: true }` succeeds with missing-dates payload in response; sets `statusType = "050"`, `finalizedAt`
- [ ] All endpoints scoped by `TenantGuard` (cross-tenant access blocked)
- [ ] `pnpm --filter imirae-incheon-backend build` and `lint` pass

## Implementation Plan

Full plan at `docs/plans/eformsign/deferred-submission-service-record.md` in this branch.

## Out of Scope

- Employee mobile app frontend (future project)
- Alimtalk changes (Phase 2 customer notification intentionally not sent; staff notifications will come from the future app)
- Provider-role auth guard (use standard `JwtGuard + TenantGuard` for now)
- Auto-finalization on cron (manual trigger only in v1)
- Prisma migration rollback or data migration of existing in-flight docs (additive only)

## Verification

Manual smoke after deploy:
1. Sign a 서비스제공기록지 in eformsign sandbox → check `statusType = "070"` and collection fields set
2. Submit daily entry via `POST /daily-records/:docId/entries`
3. Finalize with `force=false` (expect missing-dates 400 if gaps) or `force=true` (expect 200 with missing-dates in body)
4. Verify regular contracts still complete at `statusType = "050"` unchanged

## Related

Branch: `feature/eformsign-deferred-submission`
Worktree: `babyjamjam-staff/feat-eformsign-deferred-submission`
