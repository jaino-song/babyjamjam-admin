import { ContractCreationForm } from "@/app/(components)/messages/forms/ContractCreationForm";

export default async function ContractCreationPage() {
    return (
        <section data-component="contracts-creation" className="bg-card">
            <section
                data-component="contracts-creation-form"
                className="px-4 sm:px-6 md:px-12 py-6 sm:py-8"
            >
                <ContractCreationForm />
            </section>
        </section>
    );
}
