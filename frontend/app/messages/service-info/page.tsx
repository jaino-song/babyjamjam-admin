import { ServiceInfoMessageForm } from "@/app/(components)/messages/ServiceInfoMessageForm";
import { delay } from "@/app/lib/delay";

export default async function ServiceInfoMessagePage() {
    await delay(500);
    return <ServiceInfoMessageForm />;
}