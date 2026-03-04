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

// Document list types (from list_document API)
export interface EformsignStepRecipient {
  recipient_type: string;
  name: string;
  sms?: string;
  id?: string;
}

export interface EformsignCurrentStatus {
  // 3-digit codes: 003=완료, 062=참여자승인, 060=참여자요청, 061=참여자반려, etc.
  status_type: string;
  status_doc_type: string;
  status_doc_detail: string;
  step_type: string;
  step_index: string;
  step_name: string;
  step_recipients: EformsignStepRecipient[];
  step_group: number;
  expired_date: number;
  _expired: boolean;
}

export interface EformsignTemplate {
  id: string;
  name: string;
}

export interface EformsignCreator {
  recipient_type: string;
  id: string;
  name: string;
}

export interface EformsignDocument {
  id: string;
  document_number: string;
  template: EformsignTemplate;
  document_name: string;
  creator: EformsignCreator;
  created_date: number;
  last_editor: EformsignCreator;
  updated_date: number;
  current_status: EformsignCurrentStatus;
  fields: unknown[];
  next_status: unknown[];
  previous_status: unknown[];
  histories: unknown[];
  recipients: unknown[];
  detail_template_info: unknown[];
}

export interface EformsignDocumentsResponse {
  documents: EformsignDocument[];
  total_rows: number;
  limit: number;
  skip: number;
}

export interface EformsignDeleteFailure {
  document_id: string;
  code: string;
  message: string;
}

export interface EformsignDeleteDocumentsResponse {
  code: string | number;
  message: string;
  status: string | number;
  result: {
    success_result: string[];
    fail_result: EformsignDeleteFailure[];
  };
}

// View model for displaying documents
export interface EformsignDocumentView {
  doc_id: string;
  customer_name: string;
  created_date: number;
  status: "대기" | "완료" | "만료";
}
