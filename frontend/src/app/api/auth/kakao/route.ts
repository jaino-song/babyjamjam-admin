import { redirect } from "next/navigation";
import { createServerApiUrl } from "@/lib/api/server-base-url";

export async function GET(request?: Request) {
    const target = new URL(createServerApiUrl("/auth/kakao"));
    const client = request ? new URL(request.url).searchParams.get("client") : null;

    // Keep the backend's signed OAuth state and nonce flow intact. Only the
    // existing provider-client selector is forwarded; navigation metadata is
    // carried separately in browser session storage and never enters state.
    if (client === "mobile" || client === "legacy") {
        target.searchParams.set("client", client);
    }

    redirect(target.toString());
}
