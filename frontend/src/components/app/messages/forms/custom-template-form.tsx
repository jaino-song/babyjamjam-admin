"use client";

import { useEffect, useState } from "react";
import { MessageTemplate } from "@/lib/template/types";
import { renderTemplate } from "@/lib/template/variable-parser";
import { useFormStore } from "@/stores/form-store";
import { useTemplateStore } from "@/stores/template-store";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { GeneratedMsg } from "../templates/GeneratedMsg";
import { DynamicInput } from "./form-components/dynamic-input";

interface CustomTemplateFormProps {
    template: MessageTemplate;
    onPreviewMessageChange?: (message: string) => void;
}

export const CustomTemplateForm = ({ template, onPreviewMessageChange }: CustomTemplateFormProps) => {
    const locale = useLocale();
    const formStore = useFormStore();
    const { variableValues, setVariableValue } = useTemplateStore();
    const [messageOverride, setMessageOverride] = useState<string | null>(null);

    const formStoreSetters: Partial<Record<keyof typeof FORM_STORE_MAPPING, (value: string) => void>> = {
        name: formStore.setName,
        phone: formStore.setPhone,
        address: formStore.setAddress,
        birthday: formStore.setBirthday,
        employeeName: formStore.setEmployeeName,
        employeePhone: formStore.setEmployeePhone,
        employee2Name: formStore.setEmployee2Name,
        employee2Phone: formStore.setEmployee2Phone,
        startDate: formStore.setStartDate,
        endDate: formStore.setEndDate,
        fullPrice: formStore.setFullPrice,
        grant: formStore.setGrant,
        actualPrice: formStore.setActualPrice,
        area: formStore.setArea,
        voucherType: formStore.setVoucherType,
        voucherDuration: formStore.setVoucherDuration,
    };

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
        setMessageOverride(null);
        const storeKey = FORM_STORE_MAPPING[key];
        if (storeKey) {
            const setter = formStoreSetters[storeKey];
            if (typeof setter === "function") {
                setter(value);
                return;
            }
        }
        setVariableValue(key, value);
    };

    const templateValues = template.variables.reduce<Record<string, string>>((acc, variable) => {
        acc[variable.key] = getVariableValue(variable.key);
        return acc;
    }, {});
    const templateMessage = renderTemplate(template.content, templateValues);
    const generatedMessage = messageOverride ?? templateMessage;

    const handleCopy = () => {
        navigator.clipboard.writeText(generatedMessage);
        alert(t(locale, "common.copy-success-message"));
    };

    const variableItems = template.variables
        .map((variable) => ({
            token: `{{${variable.key}}}`,
            label: variable.label,
            value: getVariableValue(variable.key).trim() || "-",
        }));

    useEffect(() => {
        if (generatedMessage) {
            onPreviewMessageChange?.(generatedMessage);
        }
    }, [generatedMessage, onPreviewMessageChange]);

    return (
        <div
            data-component="messages-custom-template-form"
            className="flex flex-col grow h-full animate-fade-in"
        >
            <div className="flex flex-col h-full gap-4">
                <div className="flex flex-col gap-6">
                    {template.variables.map((variable) => (
                        <DynamicInput
                            key={variable.key}
                            variable={variable}
                            value={getVariableValue(variable.key)}
                            onChange={(value) => handleVariableChange(variable.key, value)}
                        />
                    ))}
                </div>

                <GeneratedMsg
                    title={t(locale, "common.generated-message-title")}
                    copyButtonText={t(locale, "common.copy-button")}
                    message={generatedMessage}
                    bodyDescription={`${template.name} 템플릿의 본문과 변수를 함께 검토할 수 있습니다.`}
                    metaItems={[
                        { label: "템플릿 유형", value: "사용자 템플릿" },
                        { label: "템플릿 이름", value: template.name },
                        { label: "활성 변수", value: `${variableItems.length}개` },
                    ]}
                    variableItems={variableItems}
                    variableEmptyText="입력된 변수 값이 없습니다."
                    onMessageChange={setMessageOverride}
                    handleCopy={handleCopy}
                />
            </div>
        </div>
    );
};
