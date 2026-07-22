# ADR-002: Preserve electronic documents when deleting a client

## Status

Accepted

## Context

Client deletion was blocked when a completed or submitted service record existed.
The business rule now requires the client master record to be removable while the
completed 제공기록지 remains available in the electronic-document screen.

`eformsign_doc.client_id` previously cascaded from `client`, and
`service_record_case.client_id` previously restricted deletion. Those two rules
made the requested lifecycle impossible.

## Decision

1. `eformsign_doc.client_id` and `service_record_case.client_id` are nullable.
2. Both foreign keys use `ON DELETE SET NULL`.
3. Client deletion removes only the tenant-scoped `client` row. Existing schedule
   cascades continue, while service-record cases and electronic documents remain.
4. The electronic-document list derives display names from immutable document or
   service-record snapshots when the live client is absent.
5. Completed-record snapshots, including fields required to render the signed
   record, remain part of the retained electronic document. Mutable client master
   data is no longer available through the deleted client relation.
6. Residual foreign-key failures use the stable `CLIENT_DELETE_CONFLICT` code.
   The frontend maps that code to fixed safe copy and never exposes raw database
   constraint details.

## Alternatives Considered

1. Soft-delete the client.
   - Rejected because the requested behavior is deletion of customer information,
     and the existing product does not consistently exclude soft-deleted clients.
2. Copy all document data to a new archive table before deletion.
   - Rejected because electronic documents and service-record cases already hold
     the durable snapshots needed for rendering.
3. Keep blocking completed clients.
   - Rejected because it conflicts with the revised business rule.

## Consequences

### Positive

- Completed 제공기록지 documents remain visible after client deletion.
- Client deletion no longer depends on service-record completion state.
- Branch ownership remains on retained records, preserving tenant isolation.

### Negative

- Document consumers must handle a null `clientId`.
- Historical document snapshots may retain personal data required for the signed
  record and must follow the electronic-document retention policy.

### Risks and rollback

- Deploy the database patch before backend code that deletes completed clients.
- Verification checks both nullability and validated `SET NULL` actions.
- Rollback requires first relinking or explicitly removing every row whose
  `client_id` is null; only then can the old `NOT NULL`, cascade, and restrict
  constraints be restored. Automatic destructive rollback is intentionally not
  provided.
