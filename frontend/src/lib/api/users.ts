import { api } from "@/lib/api/client";

export interface SystemAdminUserOrganization {
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
  organizations: SystemAdminUserOrganization[];
}

export async function getSystemAdminUsers(): Promise<SystemAdminUser[]> {
  const { data } = await api.get("/users");
  return Array.isArray(data) ? data : [];
}
