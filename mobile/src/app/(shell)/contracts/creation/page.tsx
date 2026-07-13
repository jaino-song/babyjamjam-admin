import { redirect } from "next/navigation";

export default function LegacyContractCreationPage() {
  redirect("/contracts/new");
}
