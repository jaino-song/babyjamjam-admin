import type {
  MessageSenderApprovalResponse,
  SystemAdminBranchMessageSenderApproval,
  SystemAdminBranchRequest,
  SystemAdminBranchUser,
} from "@babyjamjam/shared/types/message";

import { api } from "@/lib/api/client";

export type {
  MessageSenderApprovalResponse,
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

export interface SystemAdminUserBranch {
  id: string;
  name: string;
  role: string | null;
}

export interface SystemAdminUser {
  id: string;
  kakaoId: string | null;
  email: string | null;
  name: string | null;
  phone: string | null;
  birthDate: string | null;
  profileImage: string | null;
  role: string | null;
  createdAt: string;
  emailVerified: boolean;
  authProvider: string;
  branches: SystemAdminUserBranch[];
  approvalStatus: string;
  requestedRole: string | null;
}

export interface UpdateSystemAdminUserAccountInput {
  role: "admin" | "manager" | "user";
  branchIds: string[];
  expectedRole: "admin" | "manager" | "user";
  expectedBranchIds: string[];
}

export async function getSystemAdminBranchRequests(): Promise<SystemAdminBranchRequest[]> {
  const { data } = await api.get("/system-admin/branch-requests");
  return Array.isArray(data) ? data : [];
}

export async function approveSystemAdminMessageSenderApproval(
  branchId: string,
): Promise<MessageSenderApprovalResponse> {
  const { data } = await api.post(
    `/system-admin/branch-requests/${encodeURIComponent(branchId)}/message-sender-approval/approve`,
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
  const { data } = await api.patch(
    `/system-admin/branches/${encodeURIComponent(branchId)}`,
    input,
  );
  return data as SystemAdminBranchRequest;
}

export async function getSystemAdminUsers(): Promise<SystemAdminUser[]> {
  const { data } = await api.get("/users");
  return Array.isArray(data) ? data : [];
}

export async function approveSystemAdminUser(
  id: string,
  role: string,
  branchId: string,
  ownerBranchId?: string,
): Promise<void> {
  await api.post(`/users/${encodeURIComponent(id)}/approve`, {
    role,
    branchId,
    ...(ownerBranchId ? { ownerBranchId } : {}),
  });
}

export async function rejectSystemAdminUser(id: string): Promise<void> {
  await api.post(`/users/${encodeURIComponent(id)}/reject`, {});
}

export async function updateSystemAdminUserAccount(
  id: string,
  input: UpdateSystemAdminUserAccountInput,
): Promise<void> {
  await api.patch(
    `/users/${encodeURIComponent(id)}/account-assignment`,
    input,
  );
}
