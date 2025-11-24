import { ThanksMessageForm } from "@/app/(components)/messages/ThanksMessageForm";
import { delay } from "@/app/lib/delay";

export default async function ThanksMessagePage() {
    await delay(500);
    return <ThanksMessageForm />;
}
