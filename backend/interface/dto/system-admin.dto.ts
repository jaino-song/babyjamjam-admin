import { MessageSenderApprovalStatus } from "interface/dto/message-sender-approval.dto";

export interface SystemAdminBranchUserDto {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    role: string | null;
}

export interface SystemAdminBranchMessageSenderApprovalDto {
    approvalStatus: MessageSenderApprovalStatus;
    requestedAt: string | null;
    approvedAt: string | null;
    requestedBy: SystemAdminBranchUserDto | null;
}

export interface SystemAdminBranchRequestDto {
    id: string;
    name: string;
    slug: string;
    region: string | null;
    district: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    isActive: boolean;
    createdAt: string | null;
    updatedAt: string | null;
    owner: SystemAdminBranchUserDto;
    messageSenderApproval: SystemAdminBranchMessageSenderApprovalDto;
}
