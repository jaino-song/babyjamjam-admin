import { redirect } from "next/navigation";
import { createServerApiUrl } from "@/lib/api/server-base-url";

export async function GET() {
    redirect(createServerApiUrl("/auth/kakao"));
}
