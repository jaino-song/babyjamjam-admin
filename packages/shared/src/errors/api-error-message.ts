interface ApiErrorLike {
  response?: {
    status?: unknown;
    data?: unknown;
  };
}

interface ApiErrorPayload {
  error?: unknown;
  message?: unknown;
  clientId?: unknown;
}

export interface ClientConflictPayload {
  message: string;
  clientId?: number;
}

export interface ConflictPayload {
  message: string;
}

function getResponsePayload(error: unknown): ApiErrorPayload | null {
  if (!error || typeof error !== "object") return null;

  const data = (error as ApiErrorLike).response?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  return data as ApiErrorPayload;
}

function getPayloadMessage(payload: ApiErrorPayload | null): string | null {
  if (typeof payload?.message === "string" && payload.message.trim()) {
    return payload.message;
  }
  if (typeof payload?.error === "string" && payload.error.trim()) {
    return payload.error;
  }
  return null;
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  return getPayloadMessage(getResponsePayload(error)) ?? fallback;
}

export function getConflictPayload(error: unknown): ConflictPayload | null {
  if (!error || typeof error !== "object") return null;

  const response = (error as ApiErrorLike).response;
  if (response?.status !== 409) return null;

  const payload = getResponsePayload(error);
  const message = getPayloadMessage(payload);
  if (!message) return null;

  return { message };
}

export function getClientConflictPayload(error: unknown): ClientConflictPayload | null {
  const conflict = getConflictPayload(error);
  if (!conflict) return null;

  const payload = getResponsePayload(error);

  return {
    ...conflict,
    ...(typeof payload?.clientId === "number" && Number.isSafeInteger(payload.clientId)
      ? { clientId: payload.clientId }
      : {}),
  };
}
