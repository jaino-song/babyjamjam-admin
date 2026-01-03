import { InfoMessageForm } from "@/app/(components)/messages/forms/InfoMessageForm";
import { delay } from "@/app/lib/delay";

export default async function InfoMessagePage() {
    await delay(300);
    return <InfoMessageForm />;
}