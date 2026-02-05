import { redirect } from "next/navigation";
import { ClientsTable } from "../(components)/clients/ClientsTable";

interface ClientsPageProps {
    searchParams: Promise<{ filter?: string; id?: string }>;
}

export default async function ClientsPage({ searchParams }: ClientsPageProps) {
    const params = await searchParams;

    // Redirect old notification URLs to new filtered page
    // Old: /clients?filter=xxx → New: /clients/filtered?filter=xxx
    if (params.filter) {
        redirect(`/clients/filtered?filter=${params.filter}`);
    }

    return (
        <div className="bg-background">
            <section
                data-component="clients"
                className="px-4 sm:px-6 md:px-12 py-6 sm:py-8 mx-auto"
            >
                <ClientsTable />
            </section>
        </div>
    );
}
