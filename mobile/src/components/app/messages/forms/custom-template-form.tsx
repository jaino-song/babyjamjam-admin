"use client";

import { useState } from "react";
import { MessageTemplate } from "@/lib/template/types";
import { renderTemplate } from "@/lib/template/variable-parser";
import { useFormStore } from "@/stores/form-store";
import { useTemplateStore } from "@/stores/template-store";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { useToast } from "@/hooks/use-toast";
import { GeneratedMsg } from "../templates/GeneratedMsg";
import { DynamicInput } from "./form-components/dynamic-input";
import { Button } from "@/components/ui/button";

interface CustomTemplateFormProps {
    template: MessageTemplate;
}

interface TemplateFieldBinding {
    value: string;
    setValue: (value: string) => void;
}

export const CustomTemplateForm = ({ template }: CustomTemplateFormProps) => {
    const locale = useLocale();
    const { toast } = useToast();
    const formStore = useFormStore();
    const { variableValues, setVariableValue } = useTemplateStore();
    const [generatedMessage, setGeneratedMessage] = useState("");

    const formStoreFields: Record<string, TemplateFieldBinding> = {
        name: { value: formStore.name, setValue: formStore.setName },
        phone: { value: formStore.phone, setValue: formStore.setPhone },
        address: { value: formStore.address, setValue: formStore.setAddress },
        birthday: { value: formStore.birthday, setValue: formStore.setBirthday },
        employeeName: { value: formStore.employeeName, setValue: formStore.setEmployeeName },
        employeePhone: { value: formStore.employeePhone, setValue: formStore.setEmployeePhone },
        employee2Name: { value: formStore.employee2Name, setValue: formStore.setEmployee2Name },
        employee2Phone: { value: formStore.employee2Phone, setValue: formStore.setEmployee2Phone },
        startDate: { value: formStore.startDate, setValue: formStore.setStartDate },
        endDate: { value: formStore.endDate, setValue: formStore.setEndDate },
        fullPrice: { value: formStore.fullPrice, setValue: formStore.setFullPrice },
        grant: { value: formStore.grant, setValue: formStore.setGrant },
        actualPrice: { value: formStore.actualPrice, setValue: formStore.setActualPrice },
        area: { value: formStore.area, setValue: formStore.setArea },
        voucherType: { value: formStore.voucherType, setValue: formStore.setVoucherType },
        voucherDuration: { value: formStore.voucherDuration, setValue: formStore.setVoucherDuration },
    };

    const getVariableValue = (key: string): string => {
        const field = formStoreFields[key];
        if (field) {
            return field.value;
        }
        return variableValues[key] || "";
    };

    const handleVariableChange = (key: string, value: string) => {
        const field = formStoreFields[key];
        if (field) {
            field.setValue(value);
            return;
        }
        setVariableValue(key, value);
    };

    const handleGenerate = () => {
        const values: Record<string, string> = {};
        template.variables.forEach((v) => {
            values[v.key] = getVariableValue(v.key);
        });

        const message = renderTemplate(template.content, values);
        setGeneratedMessage(message);
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(generatedMessage);
        toast({ description: t(locale, "common.copy-success-message") });
    };

    return (
        <div
            data-component="messages-custom-template-form"
            className="flex flex-col grow h-full animate-fade-in"
        >
            <div className="flex flex-col grow">
                <div className="flex flex-col gap-6">
                    {template.variables.map((variable) => (
                        <DynamicInput
                            key={variable.key}
                            variable={variable}
                            value={getVariableValue(variable.key)}
                            onChange={(value) => handleVariableChange(variable.key, value)}
                        />
                    ))}

                    <Button
                        size="lg"
                        onClick={handleGenerate}
                        disabled={template.variables.some(v => v.required && !getVariableValue(v.key))}
                    >
                        {t(locale, "common.generate-button")}
                    </Button>
                </div>

                {generatedMessage && (
                    <GeneratedMsg
                        title={t(locale, "common.generated-message-title")}
                        copyButtonText={t(locale, "common.copy-button")}
                        message={generatedMessage}
                        onMessageChange={setGeneratedMessage}
                        handleCopy={handleCopy}
                    />
                )}
            </div>
        </div>
    );
};
