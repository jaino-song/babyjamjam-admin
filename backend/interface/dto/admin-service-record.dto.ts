import { Prisma } from "@prisma/client";

export type AdminServiceRecordLinkStatus = "none" | "scheduled" | "sent" | "failed" | "canceled";
export type AdminServiceRecordTokenState = "active" | "expired" | "revoked" | null;

export interface AdminServiceRecordTokenDto {
    issuedAt: Date;
    verifiedAt: Date | null;
    expiresAt: Date;
    state: AdminServiceRecordTokenState;
}

export interface AdminServiceRecordLinkDto {
    status: AdminServiceRecordLinkStatus;
    scheduledFor: Date | null;
    sentCount: number;
    lastSentAt: Date | null;
    token: AdminServiceRecordTokenDto | null;
}

export interface AdminServiceRecordEmployeeDto {
    id: number;
    name: string;
    phone: string;
}

export interface AdminServiceRecordHeaderDto {
    momName: string | null;
    momBirth: string | null;
    babyName: string | null;
    babyBirth: string | null;
    deliveryType: string | null;
    babyWeight: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface AdminServiceRecordSessionDto {
    sessionIndex: number;
    serviceDate: Date;
    locked: boolean;
    submittedAt: Date | null;
    updatedAt: Date;
    answers: Prisma.JsonValue;
    etcService: string | null;
    notes: string | null;
    paymentConfirmed: boolean;
    hasMomSignature: boolean;
}

export interface AdminServiceRecordSignatureDocDto {
    documentId: string;
    statusDetail: string;
    stepName: string;
    createdDate: Date;
    updatedDate: Date;
}

export interface AdminServiceRecordAssignmentDto {
    scheduleId: number;
    startDate: Date;
    endDate: Date;
    replaced: boolean;
    employee: AdminServiceRecordEmployeeDto;
    link: AdminServiceRecordLinkDto;
    header: AdminServiceRecordHeaderDto | null;
    totalSessions: number;
    sessions: AdminServiceRecordSessionDto[];
    signatureDoc: AdminServiceRecordSignatureDocDto | null;
}

export interface AdminServiceRecordOverviewDto {
    assignments: AdminServiceRecordAssignmentDto[];
}
