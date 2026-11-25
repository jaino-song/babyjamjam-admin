"use client";

import { useParams } from "next/navigation";

import { ServiceRecordTokenFlow } from "@/components/app/service-record/ServiceRecordTokenFlow";
import { normalizeServiceRecordLinkToken } from "@/lib/service-records/page-helpers";

export default function ServiceRecordPage() {
    const rawToken = useParams<{ token: string }>()?.token ?? "";
    const token = normalizeServiceRecordLinkToken(rawToken);
    return <ServiceRecordTokenFlow key={token} rawToken={rawToken} token={token} />;
}
