import { SurveyMessageForm } from "@/app/(components)/messages/forms/SurveyMessageForm";
import { delay } from "@/app/lib/delay";

export default async function SurveyMessagePage() {
    await delay(300);
    return <SurveyMessageForm />;
}
