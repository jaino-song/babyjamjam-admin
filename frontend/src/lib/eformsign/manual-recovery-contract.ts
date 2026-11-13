import { z } from 'zod';
import { isRecoveryBridgeId } from './recovery-bridge';

export const manualRecoveryJobIdSchema = z.string().uuid();
export const claimEpochSchema = z.string().regex(/^[1-9][0-9]{0,18}$/).refine(value =>
  !/\s/.test(value) && (value.length < 19 || value <= '9223372036854775807'));
const isoDateTime = z.string().datetime({ offset: true });
const providerIdentifier = z.string().refine(isRecoveryBridgeId);
const claim = { jobId: manualRecoveryJobIdSchema, claimEpoch: claimEpochSchema };
const session = { ...claim, claimExpiresAt: isoDateTime };

/** Open has no JSON body, including no empty object. */
export const openManualRecoveryRequestSchema = z.undefined();
export const openManualRecoveryResponseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('editable'), ...session, document: z.object({
    companyId: providerIdentifier, templateId: providerIdentifier, documentId: providerIdentifier,
  }).strict() }).strict(),
  z.object({ kind: z.literal('verify_only'), ...session }).strict(),
]);
export const verifyManualRecoveryRequestSchema = z.object({ claimEpoch: claimEpochSchema }).strict();
export const verifyManualRecoveryResponseSchema = z.object({ kind: z.enum(['pending', 'verified']), ...claim }).strict();
const errorCode = z.enum([
  'AUTH_REQUIRED', 'ACCESS_DENIED', 'RESOURCE_NOT_FOUND', 'VALIDATION_FAILED', 'REQUEST_CONFLICT',
  'MANUAL_RECOVERY_CLAIMED', 'RECOVERY_UNSUPPORTED', 'RECOVERY_STALE', 'RECOVERY_PENDING',
  'RECOVERY_PAYLOAD_EXPIRED', 'RECOVERY_UNAVAILABLE',
]);
const errorReason = z.enum([
  'legacy_unbound', 'unsupported_job', 'unverified_creation', 'frame_already_exposed',
  'payload_expired', 'claim_conflict', 'document_mismatch', 'draft_unavailable',
]);
export const manualRecoveryErrorSchema = z.object({
  code: errorCode, reason: errorReason.optional(), expiresAt: isoDateTime.optional(),
}).strict();

export type OpenManualRecoveryRequest = z.infer<typeof openManualRecoveryRequestSchema>;
export type OpenManualRecoveryResponse = z.infer<typeof openManualRecoveryResponseSchema>;
export type VerifyManualRecoveryRequest = z.infer<typeof verifyManualRecoveryRequestSchema>;
export type VerifyManualRecoveryResponse = z.infer<typeof verifyManualRecoveryResponseSchema>;
export type ManualRecoveryError = z.infer<typeof manualRecoveryErrorSchema>;

export function matchesManualRecoveryClaim(response: { jobId: string; claimEpoch: string }, jobId: string, claimEpoch?: string): boolean {
  return response.jobId.toLowerCase() === jobId.toLowerCase() && (claimEpoch === undefined || response.claimEpoch === claimEpoch);
}

/** Project errors field by field; never return upstream messages or private data. */
export function sanitizeManualRecoveryError(value: unknown): ManualRecoveryError {
  const data = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const code = errorCode.safeParse(data.code);
  const reason = errorReason.safeParse(data.reason);
  const expiresAt = isoDateTime.safeParse(data.expiresAt);
  return { code: code.success ? code.data : 'RECOVERY_UNAVAILABLE',
    ...(reason.success ? { reason: reason.data } : {}), ...(expiresAt.success ? { expiresAt: expiresAt.data } : {}) };
}
