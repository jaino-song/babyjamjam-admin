"use client";

import { useState } from "react";
import { MessageTemplate } from "@/lib/template/types";
import { renderTemplate } from "@/lib/template/variable-parser";
import { useFormStore } from "@/app/store/form-store";
import { useTemplateStore } from "@/app/store/template-store";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { t } from "@/app/lib/i18n/translations";
import { GeneratedMsg } from "../templates/GeneratedMsg";
import { DynamicInput } from "./form-components/dynamic-input";
import { Button } from "@/components/ui/button";

interface CustomTemplateFormProps {
    template: MessageTemplate;
}

export const CustomTemplateForm = ({ template }: CustomTemplateFormProps) => {
    const locale = useLocale();
    const formStore = useFormStore();
    const { variableValues, setVariableValue } = useTemplateStore();
    const [generatedMessage, setGeneratedMessage] = useState("");

    const FORM_STORE_MAPPING: Record<string, keyof typeof formStore> = {
        name: "name",
        phone: "phone",
        address: "address",
        birthday: "birthday",
        employeeName: "employeeName",
        employeePhone: "employeePhone",
        employee2Name: "employee2Name",
        employee2Phone: "employee2Phone",
        startDate: "startDate",
        endDate: "endDate",
        fullPrice: "fullPrice",
        grant: "grant",
        actualPrice: "actualPrice",
        area: "area",
        voucherType: "voucherType",
        voucherDuration: "voucherDuration",
    };

    const getVariableValue = (key: string): string => {
        const storeKey = FORM_STORE_MAPPING[key];
        if (storeKey && typeof formStore[storeKey] === "string") {
            return formStore[storeKey] as string;
        }
        return variableValues[key] || "";
    };

    const handleVariableChange = (key: string, value: string) => {
        const storeKey = FORM_STORE_MAPPING[key];
        if (storeKey) {
            const setterName = `set${storeKey.charAt(0).toUpperCase()}${storeKey.slice(1)}`;
            const setter = (formStore as any)[setterName];
            if (typeof setter === "function") {
                setter(value);
                return;
            }
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
        alert(t(locale, "common.copy-success-message"));
    };

    return (
        <div
            data-component="messages-custom-template-form"
            className="flex flex-col grow h-full bg-background animate-fade-in"
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
