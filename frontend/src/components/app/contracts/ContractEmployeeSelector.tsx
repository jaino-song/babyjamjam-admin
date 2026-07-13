"use client";

import { useState, type ComponentProps } from "react";

import { EmployeeAutocomplete } from "@/components/app/clients/EmployeeAutocomplete";
import { EmployeeFormDialog } from "@/components/app/employees/EmployeeFormDialog";
import type { Employee } from "@/hooks/useEmployees";

type ContractEmployeeSelectorProps = Omit<
  ComponentProps<typeof EmployeeAutocomplete>,
  "allowManualEntry" | "onManualEntry"
>;

export function ContractEmployeeSelector({
  onChange,
  ...autocompleteProps
}: ContractEmployeeSelectorProps) {
  const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false);

  const handleEmployeeCreated = (employee: Employee) => {
    onChange(employee.id, employee);
  };

  return (
    <>
      <EmployeeAutocomplete
        {...autocompleteProps}
        onChange={onChange}
        allowManualEntry
        onManualEntry={() => setIsEmployeeDialogOpen(true)}
      />
      <EmployeeFormDialog
        open={isEmployeeDialogOpen}
        onClose={() => setIsEmployeeDialogOpen(false)}
        onSuccess={handleEmployeeCreated}
      />
    </>
  );
}
