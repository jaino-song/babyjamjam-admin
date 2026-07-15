export const MESSAGE_SENDER_APPROVAL_STATUSES = [
    "not_requested",
    "pending",
    "approved",
] as const;

export type MessageSenderApprovalStatus =
    (typeof MESSAGE_SENDER_APPROVAL_STATUSES)[number];

export class MessageSenderApprovalResponseDto {
    approvalStatus!: MessageSenderApprovalStatus;
    isApproved!: boolean;
    canRequest!: boolean;
    requestedAt!: string | null;
    approvedAt!: string | null;

    static from(params: {
        approvalStatus: MessageSenderApprovalStatus;
        canRequest: boolean;
        requestedAt?: Date | null;
        approvedAt?: Date | null;
    }): MessageSenderApprovalResponseDto {
        const dto = new MessageSenderApprovalResponseDto();
        dto.approvalStatus = params.approvalStatus;
        dto.isApproved = params.approvalStatus === "approved";
        dto.canRequest = params.canRequest;
        dto.requestedAt = params.requestedAt?.toISOString() ?? null;
        dto.approvedAt = params.approvedAt?.toISOString() ?? null;
        return dto;
    }
}
