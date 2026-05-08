"use client";

export interface AuthActionResponse {
  success: boolean;
  message?: string;
  code?: string;
  hasKakaoAccount?: boolean;
  errors?: string[];
}

export async function resendVerificationEmail(email: string): Promise<AuthActionResponse> {
  const response = await fetch("/api/auth/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    throw new Error(`resend-verification failed: ${response.status}`);
  }
  return response.json();
}
