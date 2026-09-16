import { redirect } from "next/navigation";

export default function EmployeeSchedulePage() {
    redirect("/employees?section=schedule");
}
