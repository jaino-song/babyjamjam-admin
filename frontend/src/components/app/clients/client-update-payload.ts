import type { ClientFormData, UpdateClientDto } from "@/features/clients/types";

/**
 * What the client edit form sends to `PATCH /clients/:id`.
 *
 * The form is opened on a snapshot of the client, but the backend moves a client's end date on its
 * own while the form is open (a delayed session extends it). Sending every field would write the
 * snapshot's end date back and silently undo that extension. So an edit sends only what the user
 * actually changed, and any save that touches the service period carries the end date the form was
 * opened with as `expectedEndDate`, which the backend turns into a 409 instead of an overwrite.
 */

/** Fields that together describe the service period and that the backend validates as one unit. */
const SERVICE_PERIOD_FIELDS = ["startDate", "endDate", "duration"] as const;

/**
 * The full update body for a form state: every field the form owns, normalized exactly as it is
 * sent. The primary employee is left out when unset (the backend does not accept a null one). The
 * secondary employee keeps an explicit `null`: that is how a client's second provider is removed, and
 * the backend tells `null` (remove) from `undefined` (leave alone). An unchanged `null` still compares
 * equal to the baseline's, so it is not sent.
 */
export function serializeClientUpdateFields(form: ClientFormData): UpdateClientDto {
    return {
        name: form.name,
        birthday: form.birthday,
        dueDate: (form.dueDate ?? "") || null,
        birthDate: (form.birthDate ?? "") || null,
        address: form.address,
        phone: form.phone,
        ...(form.primaryEmployeeId !== null && { primaryEmployeeId: form.primaryEmployeeId }),
        ...(form.secondaryEmployeeId !== undefined && { secondaryEmployeeId: form.secondaryEmployeeId }),
        type: form.voucherClient ? form.type : null,
        duration: form.duration || null,
        fullPrice: form.fullPrice || null,
        grant: form.voucherClient ? form.grant || null : "0",
        actualPrice: form.voucherClient ? form.actualPrice || null : form.fullPrice || null,
        startDate: (form.startDate ?? "") || null,
        endDate: (form.endDate ?? "") || null,
        careCenter: form.careCenter,
        voucherClient: form.voucherClient,
        breastPump: form.breastPump,
        serviceStatus: form.serviceStatus,
        areaId: form.areaId || null,
    };
}

/** Whether saving `current` over `baseline` would write any service period field. */
export function hasServicePeriodChange(baseline: ClientFormData, current: ClientFormData): boolean {
    const baselineFields = serializeClientUpdateFields(baseline);
    const currentFields = serializeClientUpdateFields(current);
    return SERVICE_PERIOD_FIELDS.some((key) => currentFields[key] !== baselineFields[key]);
}

export interface BuildClientUpdatePayloadInput {
    /** Form state when the dialog was opened on the client. */
    baseline: ClientFormData;
    /** Form state being saved. */
    current: ClientFormData;
    /** Set after the user confirmed a service period whose length differs from its business days. */
    allowBusinessDayMismatch?: boolean;
}

export function buildClientUpdatePayload({
    baseline,
    current,
    allowBusinessDayMismatch,
}: BuildClientUpdatePayloadInput): UpdateClientDto {
    const baselineFields = serializeClientUpdateFields(baseline);
    const currentFields = serializeClientUpdateFields(current);

    const payload: Record<string, unknown> = {};
    for (const key of Object.keys(currentFields) as Array<keyof UpdateClientDto>) {
        const value = currentFields[key];
        if (value === undefined || value === baselineFields[key]) continue;
        payload[key] = value;
    }

    // The backend checks the supplied duration against the merged dates, so a period edit is sent
    // as the whole period rather than as whichever half happened to change.
    if (SERVICE_PERIOD_FIELDS.some((key) => key in payload)) {
        for (const key of SERVICE_PERIOD_FIELDS) payload[key] = currentFields[key];
        payload.expectedEndDate = baselineFields.endDate ?? null;
        if (allowBusinessDayMismatch) payload.allowBusinessDayMismatch = true;
    }

    return payload as UpdateClientDto;
}
