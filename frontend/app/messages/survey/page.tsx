import { SurveyMessageForm } from "@/app/(components)/messages/SurveyMessageForm";
import { delay } from "@/app/lib/delay";

export default async function SurveyMessagePage() {
    await delay(500);
    return <SurveyMessageForm />;
}
