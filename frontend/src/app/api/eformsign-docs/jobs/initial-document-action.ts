import { isAxiosError } from "axios";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { serverAPIClient } from "@/lib/api/server";
import {
  authRequiredResponse,
  backendJsonResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  invalidJsonResponse,
  localValidationProblemResponse,
  NO_STORE_CACHE_CONTROL,
  readJsonObjectBody,
  upstreamStatusProblemResponse,
  withNoStore,
} from "@/lib/api/route-utils";
import {
  INITIAL_CONFIRM_PROXY_TIMEOUT_MS,
  INITIAL_DOCUMENT_STATE_CODES,
  initialDocumentGenerationSchema,
  initialDocumentTargetSchema,
  initialNoProviderDocumentReasonSchema,
  initialRegenerationConflictSchema,
  type InitialDocumentAction,
} from "@/lib/eformsign/initial-document-recovery-contract";

const confirmationResultSchema = z.object({
  id: z.string(),
  revisionId: z.string(),
  generation: z.string(),
  operation: z.literal("record_snapshot"),
  documentVersion: z.number().nullable(),
  status: z.literal("failed"),
  reasonCode: z.enum([
    INITIAL_DOCUMENT_STATE_CODES.noProviderDocument,
    INITIAL_DOCUMENT_STATE_CODES.partialDispatch,
    INITIAL_DOCUMENT_STATE_CODES.completedDocumentDeleted,
    INITIAL_DOCUMENT_STATE_CODES.deletedStatusUnknown,
  ]),
});

export function initialRegenerationConflictResponse(error: unknown): NextResponse | null {
  return recoveryConflict(error, false);
}

function recoveryConflict(error: unknown, confirmation: boolean): NextResponse | null {
  const upstream = (error as { response?: { status?: unknown; data?: unknown } } | null)?.response;
  if (upstream?.status !== 409 || typeof upstream.data !== "object" || upstream.data === null) return null;
  const { reason, code } = upstream.data as Record<string, unknown>;
  const parsed = confirmation
    ? initialNoProviderDocumentReasonSchema.safeParse(reason)
    : initialRegenerationConflictSchema.safeParse(reason ?? code);
  if (!parsed.success) return null;
  return NextResponse.json({ code: "REQUEST_CONFLICT", reason: parsed.data }, {
    status: 409,
    headers: { "Cache-Control": NO_STORE_CACHE_CONTROL },
  });
}

export async function initialDocumentActionPost(
  request: NextRequest,
  action: InitialDocumentAction["kind"],
  params?: { revisionId: string; documentStateId: string },
): Promise<NextResponse> {
  const token = getAuthToken(request);
  if (!token) return authRequiredResponse();
  const confirmation = action === "confirm-no-provider-document";

  try {
    const body = await readJsonObjectBody(request);
    const adminBody = params ? initialDocumentGenerationSchema.safeParse(body) : undefined;
    const target = initialDocumentTargetSchema.safeParse(params ? { ...params, ...adminBody?.data } : body);
    if (!target.success || (adminBody && !adminBody.success)) {
      return localValidationProblemResponse([{
        pointer: "",
        code: "INVALID_FORMAT",
        detail: "문서 상태 식별자와 세대를 확인해 주세요.",
        location: "body",
      }]);
    }

    const { revisionId, documentStateId, expectedGeneration } = target.data;
    const path = params
      ? `/admin/service-records/revisions/${encodeURIComponent(revisionId)}/documents/${encodeURIComponent(documentStateId)}/confirm-no-provider-document`
      : confirmation ? "/eformsign-docs/jobs/confirm-no-provider-document" : "/eformsign-docs/jobs/regenerate-initial";
    const response = await serverAPIClient.post<unknown>(path, params ? { expectedGeneration } : target.data, {
      headers: getAuthHeaders(token),
      ...(confirmation ? { timeout: INITIAL_CONFIRM_PROXY_TIMEOUT_MS } : {}),
    });
    if (!confirmation) return withNoStore(backendJsonResponse(response));

    const result = confirmationResultSchema.safeParse(response.data);
    if (!result.success || result.data.id !== documentStateId || result.data.revisionId !== revisionId
        || result.data.generation !== expectedGeneration || response.status !== 200) {
      return errorResponse({ response: { status: 502 } }, "confirm initial provider document", "mutation");
    }
    return withNoStore(backendJsonResponse({ status: response.status, data: result.data }));
  } catch (error) {
    const context = `${action} service-record document`;
    if (isAxiosError(error) && !error.response && (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT")) {
      return upstreamStatusProblemResponse(504, context, "UNKNOWN");
    }
    return invalidJsonResponse(error) ?? recoveryConflict(error, confirmation) ?? errorResponse(error, context, "mutation");
  }
}
