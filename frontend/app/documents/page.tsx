import { DocumentsList } from "@/app/(components)/eformsign/DocumentsList";
import { delay } from "@/app/lib/delay";

export default async function DocumentsPage() {
    await delay(300);
    return <DocumentsList />;
}
