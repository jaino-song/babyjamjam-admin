import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/cookies";

export default async function ServiceRecordAdminLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const user = await getCurrentUser();

    if (!user) {
        redirect("/login");
    }

    return (
        <main data-component="desktop_service-record-admin_shell" data-slot="shell">
            {children}
        </main>
    );
}
