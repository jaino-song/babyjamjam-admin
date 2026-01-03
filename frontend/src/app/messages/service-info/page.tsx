import { ServiceInfoMessageForm } from "@/app/(components)/messages/forms/ServiceInfoMessageForm";
import { delay } from "@/app/lib/delay";

export default async function ServiceInfoMessagePage() {
    await delay(300);
    return <ServiceInfoMessageForm />;
}