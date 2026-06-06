import { api } from "@/lib/api/client";

export type MessageSenderApprovalStatus = "not_requested" | "pending" | "approved";

export interface SystemAdminBranchUser {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
}

export interface SystemAdminBranchMessageSenderApproval {
  senderPhone: string | null;
  approvalStatus: MessageSenderApprovalStatus;
  requestedAt: string | null;
  approvedAt: string | null;
  requestedBy: SystemAdminBranchUser | null;
}

export interface SystemAdminBranchRequest {
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
  owner: SystemAdminBranchUser;
  messageSenderApproval: SystemAdminBranchMessageSenderApproval;
}

export interface MessageSenderApprovalResponse {
  senderPhone: string | null;
  senderPhoneFormatted: string | null;
  approvalStatus: MessageSenderApprovalStatus;
  isApproved: boolean;
  canRequest: boolean;
  requestedAt: string | null;
  approvedAt: string | null;
}

export async function getSystemAdminBranchRequests(): Promise<SystemAdminBranchRequest[]> {
  const { data } = await api.get("/system-admin/branch-requests");
  return Array.isArray(data) ? data : [];
}

export async function approveSystemAdminMessageSenderApproval(
  branchId: string
): Promise<MessageSenderApprovalResponse> {
  const { data } = await api.post(
    `/system-admin/branch-requests/${branchId}/message-sender-approval/approve`
  );
  return data as MessageSenderApprovalResponse;
}
