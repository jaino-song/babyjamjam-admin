import { AxiosError } from "axios";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { serverAPIClient } from "@/app/lib/axios/server";
import { LegacyOnboardingForm } from "@/app/auth/onboarding/LegacyOnboardingForm";

interface PendingKakaoProfile {
  email?: string;
  name?: string;
}

export default async function KakaoOnboardingPage() {
  const cookieStore = await cookies();
  const pendingToken = cookieStore.get("pending_kakao_signup")?.value;

  if (!pendingToken) {
    redirect("/login");
  }

  let profile: PendingKakaoProfile;
  try {
    const { data } = await serverAPIClient.get<PendingKakaoProfile>("/auth/kakao/pending-signup", {
      headers: { "x-pending-signup-token": pendingToken },
    });
    profile = data;
  } catch (error) {
    if (error instanceof AxiosError && error.response?.status === 401) {
      redirect("/login");
    }
    throw error;
  }

  return (
    <LegacyOnboardingForm
      mode="kakao"
      email={profile.email}
      name={profile.name}
    />
  );
}
