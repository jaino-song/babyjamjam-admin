"use client";

import { api } from "@/lib/api/client";

export interface AuthActionResponse {
  success: boolean;
  message?: string;
  code?: string;
  hasKakaoAccount?: boolean;
  errors?: string[];
}

export async function resendVerificationEmail(email: string): Promise<AuthActionResponse> {
  const { data } = await api.post("/auth/resend-verification", { email });
  return data;
}
