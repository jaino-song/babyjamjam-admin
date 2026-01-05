import { IsString, IsNumber, IsOptional, ValidateNested, IsObject } from "class-validator";
import { Type } from "class-transformer";

/**
 * Document object from eformsign webhook
 * Based on: https://eformsignkr.github.io/developers/help/eformsign_webhook.html
 *
 * Status values include:
 * - doc_create: 문서 생성
 * - doc_complete: 문서 완료
 * - doc_reject_participant: 참여자 거부
 * - doc_tempsave_participant: 참여자 임시저장
 * - doc_request_participant: 참여자 요청
 * - doc_accept_participant: 참여자 승인
 * - doc_accept_outsider: 외부자 승인
 * - doc_decline: 거부됨
 * - doc_deleted: 삭제됨
 * - doc_request_revoke: 철회 요청
 * - doc_revoke: 철회됨
 * And more...
 */
class WebhookDocumentDto {
    @IsString()
    id!: string;

    @IsString()
    document_title!: string;

    @IsString()
    template_id!: string;

    @IsString()
    template_name!: string;

    @IsNumber()
    workflow_seq!: number;

    @IsString()
    workflow_name!: string;

    @IsOptional()
    @IsString()
    template_version?: string;

    @IsOptional()
    @IsString()
    history_id?: string;

    @IsString()
    status!: string; // doc_create, doc_complete, doc_reject_participant, etc.

    @IsOptional()
    @IsString()
    editor_id?: string;

    @IsNumber()
    updated_date!: number; // epoch timestamp

    @IsOptional()
    @IsString()
    outside_token?: string;

    @IsOptional()
    @IsString()
    mass_job_request_id?: string;
}

/**
 * PDF generation event object
 */
class WebhookReadyDocumentPdfDto {
    @IsString()
    document_id!: string;

    @IsString()
    document_title!: string;

    @IsNumber()
    workflow_seq!: number;

    @IsString()
    template_id!: string;

    @IsString()
    template_name!: string;

    @IsString()
    document_status!: string;

    @IsOptional()
    export_ready_list?: unknown[];

    @IsOptional()
    @IsString()
    mass_job_request_id?: string;
}

/**
 * DTO for eformsign webhook payload
 * Based on: https://eformsignkr.github.io/developers/help/eformsign_webhook.html
 *
 * Event types:
 * - "document": Document status change events
 * - "ready_document_pdf": PDF generation complete events
 */
export class EformsignWebhookPayloadDto {
    @IsString()
    webhook_id!: string;

    @IsString()
    webhook_name!: string;

    @IsString()
    company_id!: string;

    @IsString()
    event_type!: string; // "document" or "ready_document_pdf"

    @IsOptional()
    @ValidateNested()
    @Type(() => WebhookDocumentDto)
    @IsObject()
    document?: WebhookDocumentDto;

    @IsOptional()
    @ValidateNested()
    @Type(() => WebhookReadyDocumentPdfDto)
    @IsObject()
    ready_document_pdf?: WebhookReadyDocumentPdfDto;
}

/**
 * DTO for creating eformsign doc record
 */
export class CreateEformsignDocDto {
    @IsString()
    documentId!: string;

    @IsNumber()
    clientId!: number;

    @IsString()
    statusType!: string;

    @IsString()
    statusDetail!: string;

    @IsString()
    stepType!: string;

    @IsString()
    stepIndex!: string;

    @IsString()
    stepName!: string;

    @IsString()
    stepRecipientType!: string;

    @IsString()
    stepRecipientName!: string;

    @IsString()
    stepRecipientSms!: string;

    @IsString()
    expiredDate!: string; // ISO date string
}
