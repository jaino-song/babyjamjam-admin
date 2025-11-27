import { ThanksMessageForm } from "@/app/(components)/messages/forms/ThanksMessageForm";
import { delay } from "@/app/lib/delay";

export default async function ThanksMessagePage() {
    await delay(300);
    return <ThanksMessageForm />;
}
