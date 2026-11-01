import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { OnboardingForm } from "@/components/auth/onboarding-form";
import { getOptionalCurrentUser } from "@/lib/auth/cookies";
import { serverAPIClient } from "@/lib/api/server";

export default async function KakaoOnboardingPage() {
  // "Already signed in?" check: an unavailable backend counts as signed out.
  if (await getOptionalCurrentUser()) redirect("/dashboard");

  const token = (await cookies()).get("pending_kakao_signup")?.value;
  if (!token) redirect("/login");

  let profile: { email?: string; name?: string };
  try {
    const response = await serverAPIClient.get("/auth/kakao/pending-signup", {
      headers: { "x-pending-signup-token": token },
    });
    profile = response.data;
  } catch {
    redirect("/login");
  }

  return <OnboardingForm email={profile.email} name={profile.name} />;
}
