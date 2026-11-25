"use client";

import { useState } from "react";
import type { ProviderSlot } from "@babyjamjam/shared";
import type { ClientProvider, EmployeeSummary } from "@/features/clients/types";
import { useEmployees } from "@/hooks/useEmployees";
import { type Locale, t } from "@/lib/i18n/translations";
import { FormField, FormNativeSelect } from "@/components/app/ui/form-section";
import { FieldMessageText } from "@/components/app/ui/field-message";
import { Button } from "@/components/ui/button";
import { clientProviderLabel, type ClientBabyField, type ClientBabyRow } from "./client-baby-allocation";

export function ClientBabyRecordOwners({
    base, idPrefix, locale, rows, providers, knownEmployees, messages, onChange,
}: {
    base: string;
    idPrefix: string;
    locale: Locale;
    rows: readonly ClientBabyRow[];
    providers: readonly ClientProvider[];
    knownEmployees: readonly (EmployeeSummary | null | undefined)[];
    messages: Partial<Record<ClientBabyField, { text: string }>>;
    onChange: (field: ClientBabyField, slot: ProviderSlot) => void;
}) {
    const [editing, setEditing] = useState(false);
    const { data: employees = [] } = useEmployees();
    const labels = new Map(providers.map(({ slot, employeeId }) => {
        const name = employees.find((employee) => employee.id === employeeId)?.name
            ?? knownEmployees.find((employee) => employee?.id === employeeId)?.name;
        const label = clientProviderLabel(slot, locale);
        return [slot, name ? `${label} · ${name}` : label];
    }));
    const copy = (key: string) => t(locale, `clients.form.baby-record.${key}`);
    const canEdit = rows.some((row) => row.availableProviderSlots.length > 1 ||
        (row.needsReplacement && row.availableProviderSlots.length > 0));

    return (
        <section data-component={base} data-slot="baby-record-owners" data-source-component="ClientBabyRecordOwners"
            className="col-span-full grid gap-2">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-v3-dark">{copy("title")}</h3>
                {canEdit && (
                    <Button data-component={`${base}_edit`} type="button" variant="ghost" size="sm"
                        onClick={() => setEditing(!editing)}>
                        {copy(editing ? "done" : "edit")}
                    </Button>
                )}
            </div>
            {rows.map((row, index) => {
                const rank = index + 1;
                const label = rows.length === 1 ? copy("single-record") : rank <= 6
                    ? copy(`record-${rank}`) : copy("record-n").replace("{rank}", String(rank));
                const rowBase = `${base}_baby-${rank}`;
                const id = `${idPrefix}-${row.field}`;
                const message = messages[row.field]?.text ?? (row.needsReplacement ? copy("choose-replacement") : undefined);
                const showSelect = (editing && row.availableProviderSlots.length > 1)
                    || (Boolean(message) && row.availableProviderSlots.length > 0);
                return (
                    <FormField key={row.field} data-component={rowBase} htmlFor={showSelect ? id : undefined} label={label}
                        className="min-h-8 grid-cols-2 items-center"
                        labelAccessory={message && (
                            <FieldMessageText id={`${id}-error`} data-component={`${rowBase}_error`} tone="error">
                                {message}
                            </FieldMessageText>
                        )}>
                        {showSelect ? (
                            <FormNativeSelect
                                id={id}
                                data-component={`${rowBase}_recipient`}
                                aria-label={copy("recipient-label").replace("{record}", label)}
                                aria-invalid={message ? true : undefined}
                                aria-describedby={message ? `${id}-error` : undefined}
                                value={row.providerSlot === null ? "" : String(row.providerSlot)}
                                placeholder={copy("select-owner")}
                                options={row.availableProviderSlots.map((slot) => ({
                                    value: String(slot),
                                    label: labels.get(slot) ?? clientProviderLabel(slot, locale),
                                }))}
                                onValueChange={(value) => {
                                    const slot = row.availableProviderSlots.find((slot) => String(slot) === value);
                                    if (slot !== undefined) onChange(row.field, slot);
                                }}
                            />
                        ) : (
                            <span id={id} tabIndex={message ? -1 : undefined} data-component={`${rowBase}_recipient-name`}
                                className="justify-self-end text-xs font-medium text-v3-dark">
                                {row.providerSlot === null ? copy("unassigned") : labels.get(row.providerSlot)}
                            </span>
                        )}
                    </FormField>
                );
            })}
        </section>
    );
}
