import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/cookies";
import { appendSafeReturnPath, getSafeServiceRecordAdminReturnPath } from "@/lib/auth/safe-return-path";

interface ServiceRecordAdminClientLayoutProps {
    children: React.ReactNode;
    params: Promise<{ clientId: string }>;
}

export default async function ServiceRecordAdminClientLayout({
    children,
    params,
}: Readonly<ServiceRecordAdminClientLayoutProps>) {
    const { clientId } = await params;
    const returnPath = getSafeServiceRecordAdminReturnPath(
        `/service-record-admin/${clientId}`,
    );
    const user = await getCurrentUser();

    if (!user) {
        redirect(appendSafeReturnPath("/login", returnPath));
    }

    return children;
}
