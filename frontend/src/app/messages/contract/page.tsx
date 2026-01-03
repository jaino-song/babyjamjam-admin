import { ContractCreationForm } from "@/app/(components)/messages/forms/ContractCreationForm";
import { delay } from "@/app/lib/delay";

export default async function ContractMessagePage() {
    await delay(300);
    return <ContractCreationForm />;
}
