import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { OnboardingForm } from "@/components/auth/onboarding-form";
import { getCurrentUser } from "@/lib/auth/cookies";
import { serverAPIClient } from "@/lib/api/server";

export default async function AccountOnboardingPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  const token = (await cookies()).get("pending_account_onboarding")?.value;
  if (!token) redirect("/login");

  let profile: {
    email?: string;
    name?: string;
    phone?: string;
    birthDate?: string;
    branchId?: string;
    role?: "admin" | "manager" | "user";
  };
  try {
    const response = await serverAPIClient.get("/auth/onboarding/pending", {
      headers: { "x-pending-onboarding-token": token },
    });
    profile = response.data;
  } catch {
    redirect("/login");
  }

  return (
    <OnboardingForm
      mode="account"
      email={profile.email}
      name={profile.name}
      phone={profile.phone}
      birthDate={profile.birthDate}
      branchId={profile.branchId}
      role={profile.role}
    />
  );
}
