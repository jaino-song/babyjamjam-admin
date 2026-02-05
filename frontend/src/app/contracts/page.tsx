import { DocumentsList } from "@/app/(components)/eformsign/DocumentsList";

export default async function ContractsPage() {
    return (
        <div className="bg-background">
            <section
                data-component="contracts"
                className="px-4 sm:px-6 md:px-12 py-6 sm:py-8 mx-auto"
            >
                <DocumentsList />
            </section>
        </div>
    );
}
