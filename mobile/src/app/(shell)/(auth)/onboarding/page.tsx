import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { serverAPIClient } from "@/lib/api/server";
import { getOptionalCurrentUser } from "@/lib/auth/cookies";
import { AccountCompletionForm } from "@/components/auth/account-completion-form";

export default async function AccountOnboardingPage() {
  if (await getOptionalCurrentUser()) redirect("/dashboard");
  const token = (await cookies()).get("pending_account_onboarding")?.value;
  if (!token) redirect("/login");
  let profile: { email?: string; name?: string; phone?: string; birthDate?: string };
  try {
    profile = (await serverAPIClient.get("/auth/onboarding/pending", {
      headers: { "x-pending-onboarding-token": token },
    })).data;
  } catch { redirect("/login?authError=ONBOARDING_SESSION_EXPIRED"); }
  if (profile.phone && profile.birthDate) redirect("/login");
  return <AccountCompletionForm {...profile} />;
}
