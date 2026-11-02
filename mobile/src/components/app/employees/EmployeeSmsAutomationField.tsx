"use client";

import { Switch } from "@/components/ui/switch";
import { employeeMessages } from "@/features/employees/messages";
import { useLocale } from "@/providers/LocaleProvider";

import styles from "./EmployeeFormCard.module.css";

interface EmployeeSmsAutomationFieldProps {
    "data-component": string;
    checked: boolean;
    disabled?: boolean;
    onCheckedChange: (checked: boolean) => void;
}

export function EmployeeSmsAutomationField({
    "data-component": dataComponent,
    checked,
    disabled,
    onCheckedChange,
}: EmployeeSmsAutomationFieldProps) {
    const locale = useLocale();
    const label = employeeMessages[locale].smsAutomationEnabled;

    return (
        <div
            data-component={dataComponent}
            data-slot="switch-row"
            data-source-component="EmployeeSmsAutomationField"
            className={styles.switchRow}
        >
            <strong data-component={`${dataComponent}_label`} data-slot="switch-title" className={styles.switchTitle}>
                {label}
            </strong>
            <Switch
                data-component={`${dataComponent}_switch`}
                thumbDataComponent={`${dataComponent}_switch_thumb`}
                checked={checked}
                onCheckedChange={onCheckedChange}
                aria-label={label}
                disabled={disabled}
            />
        </div>
    );
}
