"use client";

import { forwardRef, useId, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { TemplateVariable } from "@/lib/template/types";
import { getTextByteLength, MAX_BODY_LENGTH, SMS_BYTE_LIMIT } from "@/lib/message/byte-length";
import { VariableConfigurator } from "./variable-configurator";
import { VariableChipEditor, type VariableChipEditorHandle } from "./variable-chip-editor";

export interface TemplateContentEditorHandle {
    insertVariable: (key: string) => void;
}

export interface TemplateContentEditorProps {
    id?: string;
    dataComponent: string;
    label?: ReactNode;
    quickInsert?: ReactNode;
    content: string;
    onContentChange: (content: string) => void;
    /** 칩 에디터의 자동완성 후보. */
    variables: TemplateVariable[];
    /** 칩을 눌렀을 때 조회할 목록. 생략하면 `variables`. */
    popoverVariables?: TemplateVariable[];
    /** 생략하면 팝오버가 읽기 전용이 된다. */
    onVariableChange?: (variable: TemplateVariable) => void;
    placeholder?: string;
    hint?: ReactNode;
    disabled?: boolean;
}

export const TemplateContentEditor = forwardRef<TemplateContentEditorHandle, TemplateContentEditorProps>(
    (
        {
            id,
            dataComponent,
            label,
            quickInsert,
            content,
            onContentChange,
            variables,
            popoverVariables,
            onVariableChange,
            placeholder,
            hint,
            disabled = false,
        },
        ref
    ) => {
        const locale = useLocale();
        const generatedId = useId();
        const editorId = id ?? `${generatedId}-content`;
        const labelId = `${editorId}-label`;
        const [activeVariableKey, setActiveVariableKey] = useState<string | null>(null);
        const chipEditorRef = useRef<VariableChipEditorHandle>(null);

        useImperativeHandle(
            ref,
            () => ({
                insertVariable: (key: string) => chipEditorRef.current?.insertVariable(key),
            }),
            []
        );

        const handleVariableClick = (key: string) => {
            setActiveVariableKey(key);
        };

        // Popover lookup is intentionally kept separate from the chip editor's
        // autocomplete list: merging the two would let a deleted variable's
        // preset re-entry (see chipVariables in TemplateEditor) keep the
        // popover open on a key that no longer exists in the real data.
        const popoverLookup = popoverVariables ?? variables;
        const activeVariable = popoverLookup.find(v => v.key === activeVariableKey) ?? null;

        const contentByteLength = getTextByteLength(content);
        const isOverSmsLimit = contentByteLength > SMS_BYTE_LIMIT;
        const isOverBodyLimit = content.length > MAX_BODY_LENGTH;

        return (
            <div className="flex flex-col gap-5">
                {quickInsert ? (
                    <div>
                        <p className="text-sm font-medium mb-2">
                            {t(locale, "template-editor.quick-insert")}
                        </p>
                        {quickInsert}
                    </div>
                ) : null}

                <div className="flex flex-col gap-2">
                    {label ? (
                        <Label id={labelId} htmlFor={editorId} onClick={() => chipEditorRef.current?.focus()}>
                            {label}
                        </Label>
                    ) : null}
                    <Popover
                        open={Boolean(activeVariable)}
                        onOpenChange={(open) => {
                            if (!open) setActiveVariableKey(null);
                        }}
                    >
                        <PopoverAnchor asChild>
                            <div data-component={`${dataComponent}_content-anchor`}>
                                <VariableChipEditor
                                    ref={chipEditorRef}
                                    id={editorId}
                                    ariaLabelledBy={label ? labelId : undefined}
                                    disabled={disabled}
                                    value={content}
                                    onChange={onContentChange}
                                    variables={variables}
                                    onVariableClick={handleVariableClick}
                                    placeholder={placeholder}
                                    dataComponent={`${dataComponent}_content-input`}
                                />
                            </div>
                        </PopoverAnchor>
                        {activeVariable ? (
                            <PopoverContent
                                data-component={`${dataComponent}_variable-popover`}
                                side="bottom"
                                align="start"
                                sideOffset={8}
                                avoidCollisions
                                className="w-80"
                                onOpenAutoFocus={(e) => e.preventDefault()}
                                onFocusOutside={(e) => e.preventDefault()}
                            >
                                {onVariableChange ? (
                                    <VariableConfigurator
                                        variant="popover"
                                        variable={activeVariable}
                                        onChange={onVariableChange}
                                    />
                                ) : (
                                    <div className="flex flex-col gap-3">
                                        <p className="text-base font-semibold text-primary">
                                            {`{{${activeVariable.key}}}`}
                                        </p>
                                        <p className="text-sm text-muted-foreground">
                                            {activeVariable.label}
                                        </p>
                                        <p className="text-sm text-muted-foreground">
                                            {activeVariable.required ? "필수" : "선택"}
                                        </p>
                                    </div>
                                )}
                            </PopoverContent>
                        ) : null}
                    </Popover>
                    <div
                        data-component={`${dataComponent}_content-footer`}
                        className="flex justify-end text-xs text-muted-foreground"
                    >
                        {isOverBodyLimit ? (
                            <span className="text-destructive">
                                {t(locale, "template-editor.body-too-long")}
                            </span>
                        ) : (
                            <span>
                                {contentByteLength} bytes ·{" "}
                                {isOverSmsLimit
                                    ? t(locale, "template-editor.byte-count-lms")
                                    : t(locale, "template-editor.byte-count-sms")}
                            </span>
                        )}
                    </div>
                    {hint ? hint : null}
                </div>
            </div>
        );
    }
);
TemplateContentEditor.displayName = "TemplateContentEditor";
