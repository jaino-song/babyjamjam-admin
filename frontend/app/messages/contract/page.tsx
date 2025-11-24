import { ContractCreationForm } from "@/app/(components)/messages/ContractCreationForm";
import { delay } from "@/app/lib/delay";

export default async function ContractMessagePage() {
    await delay(500);
    return <ContractCreationForm />;
}
