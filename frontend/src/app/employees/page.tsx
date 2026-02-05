import { EmployeesTable } from "../(components)/employees/EmployeesTable";

export default function EmployeesPage() {
    return (
        <div className="bg-background">
            <section
                data-component="employees"
                className="px-4 sm:px-6 md:px-12 py-6 sm:py-8 mx-auto"
            >
                <EmployeesTable />
            </section>
        </div>
    );
}
