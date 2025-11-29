// TypeScript declarations for eformsign embedded SDK v2
// Based on: https://eformsignkr.github.io/developers/help/eformsign_embedding_v2.html

export interface EformsignCompanyOption {
  id: string; // Company ID (required)
  country_code?: string; // Country code (e.g., "kr")
  user_key?: string; // Customer system user unique key
}

export interface EformsignUserOption {
  type: "01" | "02"; // 01: member, 02: external user
  id?: string; // User ID (email)
  access_token?: string; // Access token
  refresh_token?: string; // Refresh token
  external_token?: string; // External token for external user processing
  external_user_info?: {
    name?: string; // External user name
  };
}

export interface EformsignModeOption {
  type: "01" | "02" | "03"; // 01: new document, 02: document processing, 03: preview
  template_id?: string; // Template ID
  template_version?: string; // Template version
  document_id?: string; // Document ID (required for type 02, 03)
}

export interface EformsignLayoutOption {
  lang_code?: "ko" | "en" | "ja"; // Language code
  header?: boolean; // Show header
  footer?: boolean; // Show footer
  viewer_toolbar?: boolean; // Show viewer toolbar
}

export interface EformsignPrefillField {
  id: string; // Field ID
  value: string; // Field value
  enabled?: boolean; // Enable/disable field
  required?: boolean; // Required field
}

export interface EformsignRecipient {
  step_idx: string; // Workflow step index (starts from "2" when recipients exist)
  step_type: "05" | "06"; // 05: participant, 06: reviewer
  name: string; // Recipient name
  id?: string; // Recipient ID/email
  sms?: string; // Recipient phone number
  use_mail?: boolean; // Use email notification
  use_sms?: boolean; // Use SMS notification
  auth?: {
    password?: string; // Password for document access
    password_hint?: string; // Password hint
    valid?: {
      day?: number; // Document sending deadline (days)
      hour?: number; // Document sending deadline (hours)
    };
  };
}

export interface EformsignPrefillOption {
  document_name?: string; // Document title
  fields?: EformsignPrefillField[]; // Prefill fields
  recipients?: EformsignRecipient[]; // Recipients
  comment?: string; // Message/comment
}

export interface EformsignDocumentOption {
  company: EformsignCompanyOption;
  user?: EformsignUserOption;
  mode: EformsignModeOption;
  layout?: EformsignLayoutOption;
  prefill?: EformsignPrefillOption;
  return_fields?: string[]; // Fields to return in success callback
}

export interface EformsignSuccessResponse {
  code: string; // "-1" for success
  document_id?: string; // Created document ID
  field_values?: Record<string, string>; // Return field values
}

export interface EformsignErrorResponse {
  code: string;
  message: string;
}

export interface EformsignActionResponse {
  type: string;
  data: unknown;
}

export type EformsignSuccessCallback = (response: EformsignSuccessResponse) => void;
export type EformsignErrorCallback = (response: EformsignErrorResponse) => void;
export type EformsignActionCallback = (response: EformsignActionResponse) => void;

export interface EformSignDocument {
  document(
    documentOption: EformsignDocumentOption,
    iframeId: string,
    successCallback?: EformsignSuccessCallback,
    errorCallback?: EformsignErrorCallback,
    actionCallback?: EformsignActionCallback
  ): void;
  open(): void;
}

// Extend Window interface to include eformsign SDK
declare global {
  interface Window {
    EformSignDocument: new () => EformSignDocument;
  }
}

// Document list types
export interface EformsignDocument {
  doc_id: string; // Document ID
  doc_title: string; // Document title
  doc_status: string; // Document status code
  doc_status_name: string; // Document status name (e.g., "완료", "대기 중")
  workflow_seq: number; // Current workflow sequence
  workflow_name: string; // Workflow step name
  created_date: number; // Creation timestamp
  updated_date: number; // Last update timestamp
  template_id: string; // Template ID
  template_name: string; // Template name
  template_version: string; // Template version
  history_id: string; // History ID
  mass_send_id?: string; // Mass send ID (optional)
}

export interface EformsignDocumentsResponse {
  total_count: number; // Total number of documents
  documents: EformsignDocument[]; // Array of documents
}

