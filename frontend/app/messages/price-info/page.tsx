import { PriceInfoMessageForm } from "@/app/(components)/messages/forms/PriceInfoMessageForm";
import { delay } from "@/app/lib/delay";

export default async function PriceInfoMessagePage() {
    await delay(300);
    return <PriceInfoMessageForm />;
}