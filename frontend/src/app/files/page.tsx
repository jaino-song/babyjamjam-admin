import { DocumentsTable } from "../(components)/documents/DocumentsTable";

export default function DocumentsPage() {
    return (
        <div className="bg-background">
            <section
                data-component="documents"
                className="px-2 sm:px-3 md:px-6 py-3 sm:py-4 mx-auto"
            >
                <DocumentsTable />
            </section>
        </div>
    );
}
