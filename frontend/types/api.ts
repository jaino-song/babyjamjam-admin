/**
 * API Type Definitions for imirae-incheon.com
 *
 * Single source of truth for all request/response shapes.
 * All implementation code MUST import types from this file.
 */

// ---------------------------------------------------------------------------
// Error Codes
// ---------------------------------------------------------------------------

export const API_ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  EMAIL_SEND_FAILED: "EMAIL_SEND_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ApiErrorCode =
  (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

// ---------------------------------------------------------------------------
// Response Envelope
// ---------------------------------------------------------------------------

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: {
    fieldErrors?: Record<string, string>;
  };
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  error: null;
}

export interface ApiErrorResponse {
  success: false;
  data: null;
  error: ApiError;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// ---------------------------------------------------------------------------
// POST /api/v1/contact
// ---------------------------------------------------------------------------

export interface ContactFormRequest {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  privacyAgreed: boolean;
}

export interface ContactFormResponseData {
  message: string;
}

export type ContactFormResponse = ApiResponse<ContactFormResponseData>;

// ---------------------------------------------------------------------------
// POST /api/v1/consultation
// ---------------------------------------------------------------------------

export interface ConsultationRequest {
  name: string;
  phone: string;
  dueDate?: string;
  message?: string;
  privacyAgreed: boolean;
}

export interface ConsultationResponseData {
  message: string;
}

export type ConsultationResponse = ApiResponse<ConsultationResponseData>;
