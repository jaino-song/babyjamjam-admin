import type { ServiceStatus, UpdateClientDto } from "@/lib/client/types";

/**
 * What the mobile client edit forms send to `PATCH /clients/:id`.
 *
 * Mirror of the desktop `frontend/src/components/app/clients/client-update-payload.ts`; the parity
 * test next to this file keeps the two in step. Both mobile edit surfaces (the clients wizard page
 * and the client form dialog) share this one helper.
 *
 * A form is opened on a snapshot of the client, but the backend moves a client's end date on its
 * own while the form is open (a delayed session extends it). Sending every field would write the
 * snapshot's end date back and silently undo that extension. So an edit sends only what the user
 * actually changed, and any save that touches the service period carries the end date the form was
 * opened with as `expectedEndDate`, which the backend turns into a 409 instead of an overwrite.
 */

/** What the backend answers when `expectedEndDate` no longer matches the stored end date. */
export const CLIENT_END_DATE_CHANGED_MESSAGE =
    "그동안 서비스 종료일이 바뀌어 저장하지 않았어요. 창을 닫고 다시 열어 최신 정보로 수정해 주세요.";

export const END_DATE_CHANGED_PROBLEM_CODE = "SERVICE_RECORD_WRITE_TARGET_CHANGED";

/**
 * The fields either mobile edit form holds. `birthDate` and `areaId` are absent from the dialog,
 * and an absent field is never sent.
 */
export interface ClientUpdateFormFields {
    name: string;
    birthday?: string | null;
    dueDate?: string | null;
    birthDate?: string | null;
    address?: string | null;
    phone?: string | null;
    primaryEmployeeId: number | null;
    secondaryEmployeeId?: number | null;
    type?: string | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    careCenter: boolean;
    voucherClient: boolean;
    breastPump: boolean;
    serviceStatus?: ServiceStatus | null;
    areaId?: string | null;
}

/** Fields that together describe the service period and that the backend validates as one unit. */
const SERVICE_PERIOD_FIELDS = ["startDate", "endDate", "duration"] as const;

/**
 * The full update body for a form state: every field the form owns, normalized exactly as it is
 * sent. Employee ids are left out when unset because the backend's `@IsOptional` skips only
 * `undefined`, not `null`.
 */
export function serializeClientUpdateFields(form: ClientUpdateFormFields): UpdateClientDto {
    return {
        name: form.name,
        birthday: form.birthday,
        dueDate: (form.dueDate ?? "") || null,
        ...(form.birthDate !== undefined && { birthDate: form.birthDate || null }),
        address: form.address,
        phone: form.phone,
        ...(form.primaryEmployeeId !== null && { primaryEmployeeId: form.primaryEmployeeId }),
        ...(form.secondaryEmployeeId !== null && { secondaryEmployeeId: form.secondaryEmployeeId }),
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
        ...(form.areaId !== undefined && { areaId: form.areaId || null }),
    };
}

/** Whether saving `current` over `baseline` would write any service period field. */
export function hasServicePeriodChange(
    baseline: ClientUpdateFormFields,
    current: ClientUpdateFormFields,
): boolean {
    const baselineFields = serializeClientUpdateFields(baseline);
    const currentFields = serializeClientUpdateFields(current);
    return SERVICE_PERIOD_FIELDS.some((key) => currentFields[key] !== baselineFields[key]);
}

export interface BuildClientUpdatePayloadInput {
    /** Form state when the form was opened on the client. */
    baseline: ClientUpdateFormFields;
    /** Form state being saved. */
    current: ClientUpdateFormFields;
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
