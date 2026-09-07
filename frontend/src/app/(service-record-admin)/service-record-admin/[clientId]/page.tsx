import { ServiceRecordAdminViewer } from "@/components/app/service-record/ServiceRecordAdminWizard";

interface ServiceRecordAdminPageProps {
    params: Promise<{ clientId: string }>;
}

export default async function ServiceRecordAdminPage({ params }: ServiceRecordAdminPageProps) {
    const { clientId } = await params;
    return <ServiceRecordAdminViewer clientId={clientId} />;
}
