import { GreetingMessageForm } from "@/app/(components)/messages/forms/GreetingMessageForm";
import { delay } from "@/app/lib/delay";

export default async function GreetingMessagePage() {
    await delay(500);
    return <GreetingMessageForm />;
}