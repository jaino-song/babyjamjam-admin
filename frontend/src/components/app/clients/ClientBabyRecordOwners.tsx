"use client";

import type { ExistingBaby, ProviderSlot } from "@babyjamjam/shared";
import type { Client, ClientProvider, EmployeeSummary } from "@/features/clients/types";
import { useEmployees } from "@/hooks/useEmployees";
import { type Locale, t } from "@/lib/i18n/translations";
import { FormField, FormNativeSelect, FormTextInput } from "@/components/app/ui/form-section";
import { FieldMessageText } from "@/components/app/ui/field-message";
import { clientProviderLabel, clientRecordRankLabel, type ClientBabyField, type ClientBabyRow } from "./client-baby-allocation";

type OwnerRow = Pick<ClientBabyRow, "field" | "providerSlot">
    & Partial<Pick<ClientBabyRow, "availableProviderSlots" | "canChangeProvider" | "needsReplacement">>;

export function ClientBabyRecordOwners({
    base, idPrefix, locale, rows, providers, knownEmployees, messages, onChange,
}: {
    base: string;
    idPrefix: string;
    locale: Locale;
    rows: readonly OwnerRow[];
    providers: readonly ClientProvider[];
    knownEmployees: readonly (EmployeeSummary | null | undefined)[];
    messages: Partial<Record<ClientBabyField, { text: string }>>;
    onChange?: (field: ClientBabyField, slot: ProviderSlot) => void;
}) {
    const { data: employees = [] } = useEmployees();
    const labels = new Map(providers.map(({ slot, employeeId }) => {
        const name = employees.find((employee) => employee.id === employeeId)?.name
            ?? knownEmployees.find((employee) => employee?.id === employeeId)?.name;
        const label = clientProviderLabel(slot, locale);
        return [slot, name ? `${label} · ${name}` : label];
    }));
    const copy = (key: string) => t(locale, `clients.form.baby-record.${key}`);

    return (
        <section data-component={base} data-slot="baby-record-owners" data-source-component="ClientBabyRecordOwners"
            className="col-span-full grid gap-2">
            <h3 className="text-sm font-semibold text-v3-dark">{copy("title")}</h3>
            {rows.map((row, index) => {
                const rank = index + 1;
                const label = rows.length === 1 ? copy("single-record") : clientRecordRankLabel(rank, locale);
                const rowBase = `${base}_baby-${rank}`;
                const id = `${idPrefix}-${row.field}`;
                const message = messages[row.field]?.text ?? (row.needsReplacement ? copy("choose-replacement") : undefined);
                const availableSlots = row.availableProviderSlots ?? [];
                const showSelect = onChange && (row.needsReplacement || (row.canChangeProvider
                    && (row.providerSlot === null || availableSlots.length > 1 || Boolean(message))));
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
                                disabled={availableSlots.length === 0}
                                value={row.providerSlot === null ? "" : String(row.providerSlot)}
                                placeholder={copy(availableSlots.length === 0 ? "unassigned" : "select-owner")}
                                options={availableSlots.map((slot) => ({
                                    value: String(slot),
                                    label: labels.get(slot) ?? clientProviderLabel(slot, locale),
                                }))}
                                onValueChange={(value) => {
                                    const slot = availableSlots.find((slot) => String(slot) === value);
                                    if (slot !== undefined) onChange?.(row.field, slot);
                                }}
                            />
                        ) : (
                            <span id={id} tabIndex={message ? -1 : undefined} data-component={`${rowBase}_recipient-name`}
                                className="justify-self-end text-xs font-medium text-v3-dark">
                                {row.providerSlot === null ? copy("unassigned")
                                    : labels.get(row.providerSlot) ?? clientProviderLabel(row.providerSlot, locale)}
                            </span>
                        )}
                    </FormField>
                );
            })}
        </section>
    );
}

export function ClientBabyRetirementList({ base, client, babies, locale }: {
    base: string;
    client: Client;
    babies: readonly (ExistingBaby & { rank: number })[];
    locale: Locale;
}) {
    const { data: employees = [] } = useEmployees();
    const savedSlots = new Map(client.babyAssignments?.map(({ babyId, providerSlot }) => [babyId, providerSlot]));
    const savedProviders = new Map(client.providers?.map(({ slot, employeeId }) => [slot, employeeId]));
    return (
        <ul data-component={base} data-slot="affected-babies" className="grid gap-1">
            {babies.map(({ babyId, rank }) => {
                const slot = savedSlots.get(babyId);
                const staff = slot === 0 ? client.primaryEmployee : slot === 1 ? client.secondaryEmployee : null;
                const employeeId = slot == null ? undefined : savedProviders.get(slot)
                    ?? (client.providers === undefined && client.serviceStatus !== "terminated" ? staff?.id : undefined);
                const name = [client.primaryEmployee, client.secondaryEmployee].find((employee) => employee?.id === employeeId)?.name
                    ?? employees.find((employee) => employee.id === employeeId)?.name;
                const owner = slot == null ? t(locale, "clients.form.baby-record.unassigned")
                    : name ?? clientProviderLabel(slot, locale);
                return (
                    <li key={babyId} data-component={`${base}_baby-${rank}`}>
                        {clientRecordRankLabel(rank, locale)} · {owner}
                    </li>
                );
            })}
        </ul>
    );
}

export function ClientSavedProviderInput({ employeeId, ...props }: Omit<
    React.ComponentProps<typeof FormTextInput>, "value" | "disabled"
> & { employeeId: number }) {
    const { data: employees = [] } = useEmployees();
    const name = employees.find((employee) => employee.id === employeeId)?.name;
    return <FormTextInput {...props} disabled value={name ?? ""} />;
}
