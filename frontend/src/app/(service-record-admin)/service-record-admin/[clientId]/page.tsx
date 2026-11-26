import { ServiceRecordAdminViewer } from "@/components/app/service-record/ServiceRecordAdminWizard";

interface ServiceRecordAdminPageProps {
    searchParams?: Promise<{ caseId?: string | string[] }>;
    params: Promise<{ clientId: string }>;
}

export default async function ServiceRecordAdminPage({ params, searchParams }: ServiceRecordAdminPageProps) {
    const { clientId } = await params;
    const caseId = (await searchParams)?.caseId;
    return <ServiceRecordAdminViewer clientId={clientId} caseId={Array.isArray(caseId) ? "" : caseId} />;
}
