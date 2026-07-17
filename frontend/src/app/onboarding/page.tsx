import { AxiosError } from "axios";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { serverAPIClient } from "@/app/lib/axios/server";
import { LegacyOnboardingForm } from "@/app/auth/onboarding/LegacyOnboardingForm";

interface PendingAccountProfile {
  email?: string;
  name?: string;
  phone?: string;
  birthDate?: string;
  branchId?: string;
  role?: "admin" | "manager" | "user";
}

export default async function AccountOnboardingPage() {
  const cookieStore = await cookies();
  const pendingToken = cookieStore.get("pending_account_onboarding")?.value;

  if (!pendingToken) {
    redirect("/login");
  }

  let profile: PendingAccountProfile;
  try {
    const { data } = await serverAPIClient.get<PendingAccountProfile>("/auth/onboarding/pending", {
      headers: { "x-pending-onboarding-token": pendingToken },
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
      mode="account"
      email={profile.email}
      name={profile.name}
      initialPhone={profile.phone}
      initialBirthDate={profile.birthDate}
      initialBranchId={profile.branchId}
      initialRole={profile.role}
    />
  );
}
