import { PriceInfoMessageForm } from "@/app/(components)/messages/PriceInfoMessageForm";
import { delay } from "@/app/lib/delay";

export default async function PriceInfoMessagePage() {
    await delay(500);
    return <PriceInfoMessageForm />;
}