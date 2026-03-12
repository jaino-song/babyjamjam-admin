import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import { PhoneNumber } from "domain/value-objects/phone-number.vo";

export const MESSAGE_SENDER_APPROVAL_STATUSES = [
    "not_requested",
    "pending",
    "approved",
] as const;

export type MessageSenderApprovalStatus =
    (typeof MESSAGE_SENDER_APPROVAL_STATUSES)[number];

export class RequestMessageSenderApprovalDto {
    @IsString()
    @IsNotEmpty({ message: "발신번호는 필수입니다." })
    @MaxLength(20, { message: "발신번호 형식이 올바르지 않습니다." })
    senderPhone!: string;
}

export class MessageSenderApprovalResponseDto {
    senderPhone!: string | null;
    senderPhoneFormatted!: string | null;
    approvalStatus!: MessageSenderApprovalStatus;
    isApproved!: boolean;
    canRequest!: boolean;
    requestedAt!: string | null;
    approvedAt!: string | null;

    static from(params: {
        senderPhone: string | null;
        approvalStatus: MessageSenderApprovalStatus;
        canRequest: boolean;
        requestedAt?: Date | null;
        approvedAt?: Date | null;
    }): MessageSenderApprovalResponseDto {
        const dto = new MessageSenderApprovalResponseDto();
        const normalizedPhone = PhoneNumber.create(params.senderPhone);

        dto.senderPhone = normalizedPhone?.toString() ?? params.senderPhone ?? null;
        dto.senderPhoneFormatted =
            normalizedPhone?.toFormattedString() ?? params.senderPhone ?? null;
        dto.approvalStatus = params.approvalStatus;
        dto.isApproved = params.approvalStatus === "approved" && !!dto.senderPhone;
        dto.canRequest = params.canRequest;
        dto.requestedAt = params.requestedAt?.toISOString() ?? null;
        dto.approvedAt = params.approvedAt?.toISOString() ?? null;
        return dto;
    }
}
