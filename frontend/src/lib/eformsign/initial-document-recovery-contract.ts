import { z } from "zod";

const documentIdentifier = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
const generation = z.string().max(255).regex(/^\S+$/);

export const initialDocumentTargetSchema = z.object({
  revisionId: documentIdentifier,
  documentStateId: documentIdentifier,
  expectedGeneration: generation,
}).strict();

export const initialDocumentGenerationSchema = initialDocumentTargetSchema.pick({ expectedGeneration: true });

const initialDocumentProjectionSchema = z.object({
  stateId: documentIdentifier,
  revisionId: documentIdentifier,
  generation,
});

export const initialRegenerationProjectionSchema = initialDocumentProjectionSchema.extend({
  clientId: z.number().int().positive(),
  ready: z.boolean(),
  reasonCode: z.string().nullable(),
});

export const initialNoProviderDocumentProjectionSchema = initialDocumentProjectionSchema.extend({
  suffix: z.string().regex(/^\[SR-[0-9a-f]{8}-r[1-9]\d*-v[1-9]\d*\]$/i),
  unlinkedChunkOrdinals: z.array(z.string().regex(/^\([1-9]\d*\/[1-9]\d*\)$/)),
});

export type InitialDocumentTarget = z.infer<typeof initialDocumentTargetSchema>;
export type InitialRegenerationProjection = z.infer<typeof initialRegenerationProjectionSchema>;
export type InitialNoProviderDocumentProjection = z.infer<typeof initialNoProviderDocumentProjectionSchema>;
type InitialDocumentProjection = z.infer<typeof initialDocumentProjectionSchema>;
export type InitialDocumentAction =
  | { kind: "regenerate"; target: InitialDocumentProjection }
  | { kind: "confirm-no-provider-document"; target: InitialNoProviderDocumentProjection };

export function initialDocumentTarget({ stateId, revisionId, generation }: InitialDocumentProjection): InitialDocumentTarget {
  return { revisionId, documentStateId: stateId, expectedGeneration: generation };
}

export function matchesInitialDocument(
  left: InitialDocumentProjection | undefined,
  right: InitialDocumentProjection,
): boolean {
  return left?.stateId === right.stateId && left.revisionId === right.revisionId && left.generation === right.generation;
}

export const INITIAL_DOCUMENT_STATE_CODES = {
  noProviderDocument: "SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT",
  partialDispatch: "SERVICE_RECORD_INITIAL_PARTIAL_DISPATCH",
  completedDocumentDeleted: "SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED",
  deletedStatusUnknown: "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN",
  siblingInProgress: "SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS",
  siblingCompleted: "SERVICE_RECORD_INITIAL_SIBLING_COMPLETED",
  jobInProgress: "SERVICE_RECORD_INITIAL_JOB_IN_PROGRESS",
  rejected: "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED",
  voided: "SERVICE_RECORD_REVISION_DOCUMENT_VOIDED",
} as const;

// Wire values from backend/domain/constants/service-record-initial-no-provider-document.ts.
export const initialNoProviderDocumentReasonSchema = z.enum([
  "SERVICE_RECORD_INITIAL_NO_DOC_NOT_ELIGIBLE",
  "SERVICE_RECORD_INITIAL_NO_DOC_GENERATION_CHANGED",
  "SERVICE_RECORD_INITIAL_NO_DOC_SETTLING",
  "SERVICE_RECORD_INITIAL_NO_DOC_VENDOR_CHECK_IN_PROGRESS",
  "SERVICE_RECORD_INITIAL_NO_DOC_VENDOR_CHECK_INCOMPLETE",
  "SERVICE_RECORD_INITIAL_NO_DOC_PROVIDER_DOCUMENT_FOUND",
  "SERVICE_RECORD_INITIAL_NO_DOC_LEFT_TO_PROVIDER_RECOVERY",
  "SERVICE_RECORD_INITIAL_NO_DOC_STATE_CHANGED",
  "SERVICE_RECORD_INITIAL_NO_DOC_NOT_READY_AFTER_OUTCOME",
]);

export type InitialNoProviderDocumentReason = z.infer<typeof initialNoProviderDocumentReasonSchema>;

export const initialRegenerationConflictSchema = z.enum([
  ...Object.values(INITIAL_DOCUMENT_STATE_CODES),
  "SERVICE_RECORD_INITIAL_STATE_NOT_FOUND",
  "SERVICE_RECORD_INITIAL_STATE_NOT_READY",
  "SERVICE_RECORD_INITIAL_REVISION_CHANGED",
  "SERVICE_RECORD_INITIAL_GENERATION_CHANGED",
    "SERVICE_RECORD_INITIAL_ACTIVE_KEY_CONFLICT",
    "SERVICE_RECORD_REVISION_SOURCE_UNAVAILABLE",
  "SERVICE_RECORD_REVISION_GENERATION_SCOPE_CHANGED",
  "SERVICE_RECORD_REVISION_GENERATION_UNAVAILABLE",
  "SERVICE_RECORD_WRITE_TARGET_CHANGED",
]);
export type InitialRegenerationConflict = z.infer<typeof initialRegenerationConflictSchema>;

// The third-party scan can run for up to 150 seconds.
export const INITIAL_CONFIRM_PROXY_TIMEOUT_MS = 170_000;
export const INITIAL_CONFIRM_CLIENT_CONFIG = { timeout: 180_000, _retry: true } as const;
