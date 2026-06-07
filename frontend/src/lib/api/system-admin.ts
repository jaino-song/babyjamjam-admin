import type {
  MessageSenderApprovalResponse,
  SystemAdminBranchRequest,
  SystemAdminBranchMessageSenderApproval,
  SystemAdminBranchUser,
  MessageSenderApprovalStatus,
} from "@babyjamjam/shared/types/message";
import { api } from "@/lib/api/client";

export type {
  MessageSenderApprovalResponse,
  MessageSenderApprovalStatus,
  SystemAdminBranchMessageSenderApproval,
  SystemAdminBranchRequest,
  SystemAdminBranchUser,
};

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
