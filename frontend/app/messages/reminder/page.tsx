import { ReminderMessageForm } from "@/app/(components)/messages/forms/ReminderMessageForm";
import { delay } from "@/app/lib/delay";

export default async function ReminderMessagePage() {
    await delay(500);
    return <ReminderMessageForm />;
}