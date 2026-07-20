import { redirect } from "next/navigation";

export default async function AccountOnboardingPage() {
    redirect("/login?authError=ACCOUNT_PROFILE_INCOMPLETE");
}
