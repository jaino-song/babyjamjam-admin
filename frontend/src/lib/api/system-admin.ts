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

export interface SystemAdminBranchInput {
  name: string;
  slug: string;
  ownerId: string | null;
  region?: string;
  district?: string;
  address?: string;
  phone?: string;
  email?: string;
  isActive: boolean;
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

export async function createSystemAdminBranch(
  input: SystemAdminBranchInput,
): Promise<SystemAdminBranchRequest> {
  const { data } = await api.post("/system-admin/branches", input);
  return data as SystemAdminBranchRequest;
}

export async function updateSystemAdminBranch(
  branchId: string,
  input: SystemAdminBranchInput,
): Promise<SystemAdminBranchRequest> {
  const { data } = await api.patch(`/system-admin/branches/${branchId}`, input);
  return data as SystemAdminBranchRequest;
}
