import { BadRequestException } from "@nestjs/common";
import { CLIENT_DURATION_NEEDS_SERVICE_PERIOD_MESSAGE, clientDurationOutOfRangeMessage } from "domain/entities/client.entity";
import type { ClientEntity } from "domain/entities/client.entity";
import { normalizeClientPricing } from "domain/services/client-pricing";
import type { CreateClientUsecase } from "./create-client.usecase";
import type { UpdateClientParams } from "./update-client.usecase";
import { assertClientDurationMatchesDates, deriveClientDuration, mergeAndValidateClientServicePeriod, parseClientDate } from "./client-write-validation";

type DateField = "startDate" | "endDate" | "dueDate" | "birthDate";
/** Schema-validated, canonical input. Voucher labels must be resolved before this step. */
export type ClientWriteInput = Omit<UpdateClientParams, DateField | "eDocId"> & {
    [Field in DateField]?: string | null;
};
export type ClientWriteExisting = Pick<ClientEntity,
    "voucherClient" | "type" | "fullPrice" | "grant" | "actualPrice" | "duration" | "startDate" | "endDate"
>;
type ClientPricingUpdate = Pick<ClientWriteInput, "voucherClient" | "type" | "duration" | "fullPrice" | "grant" | "actualPrice">;

export function normalizeMergedClientPricing(existing: ClientWriteExisting, updates: ClientPricingUpdate): ReturnType<typeof normalizeClientPricing> | undefined {
    const hasPricingUpdate = updates.voucherClient !== undefined || updates.type !== undefined
        || updates.duration !== undefined || updates.fullPrice !== undefined
        || updates.grant !== undefined || updates.actualPrice !== undefined;
    if (!hasPricingUpdate) return undefined;
    return normalizeClientPricing({
        voucherClient: updates.voucherClient ?? existing.voucherClient,
        type: updates.type === undefined ? existing.type : updates.type,
        fullPrice: updates.fullPrice === undefined ? existing.fullPrice : updates.fullPrice,
        grant: updates.grant === undefined ? existing.grant : updates.grant,
        actualPrice: updates.actualPrice === undefined ? existing.actualPrice : updates.actualPrice,
    });
}

function validatedDerivedDuration(
    existing: Pick<ClientWriteExisting, "startDate" | "endDate"> | null,
    updates: Pick<UpdateClientParams, "startDate" | "endDate" | "duration">,
): number | null {
    const period = mergeAndValidateClientServicePeriod(existing, updates);
    const derived = deriveClientDuration(period.startDate, period.endDate);
    assertClientDurationMatchesDates(updates.duration, derived);
    const hasDateUpdate = existing !== null && (updates.startDate !== undefined || updates.endDate !== undefined);
    if (hasDateUpdate && derived !== null && updates.duration === null) {
        throw new BadRequestException(clientDurationOutOfRangeMessage(derived));
    }
    if (hasDateUpdate && derived === null && updates.duration !== undefined && updates.duration !== null) {
        throw new BadRequestException(CLIENT_DURATION_NEEDS_SERVICE_PERIOD_MESSAGE);
    }
    return derived;
}

/** Same write descriptor for inspection, automation planning, and persistence; no lookups or writes. */
export function normalizeClientCreateInput(
    input: ClientWriteInput & { name: string; phone: string },
): Parameters<CreateClientUsecase["execute"]>[1] {
    const dates = {
        startDate: parseClientDate(input.startDate, "startDate") ?? null,
        endDate: parseClientDate(input.endDate, "endDate") ?? null,
    };
    const derived = validatedDerivedDuration(null, { ...dates, duration: input.duration });
    const voucherClient = input.voucherClient ?? false;
    return {
        name: input.name,
        address: input.address ?? null,
        phone: input.phone,
        ...normalizeClientPricing({
            voucherClient,
            type: input.type ?? null,
            fullPrice: input.fullPrice ?? null,
            grant: input.grant ?? null,
            actualPrice: input.actualPrice ?? null,
        }),
        duration: input.duration ?? derived ?? null,
        ...dates,
        careCenter: input.careCenter ?? null,
        voucherClient,
        birthday: input.birthday ?? null,
        dueDate: parseClientDate(input.dueDate, "dueDate") ?? null,
        birthDate: parseClientDate(input.birthDate, "birthDate") ?? null,
        serviceStatus: input.serviceStatus ?? null,
        breastPump: input.breastPump ?? false,
        areaId: input.areaId ?? null,
    };
}

const CLIENT_UPDATE_FIELDS = [
    "name", "address", "phone", "type", "duration", "fullPrice", "grant", "actualPrice",
    "startDate", "endDate", "careCenter", "voucherClient", "birthday", "dueDate", "birthDate",
    "serviceStatus", "breastPump", "areaId",
] as const satisfies readonly (keyof ClientWriteInput)[];

export function normalizeClientUpdateInput(existing: ClientWriteExisting, input: ClientWriteInput): UpdateClientParams {
    // Select fields explicitly: IDs, approval artifacts and caller metadata are never part of the write.
    const updates = Object.fromEntries(CLIENT_UPDATE_FIELDS
        .filter((key) => input[key] !== undefined)
        .map((key) => [key, input[key]])) as ClientWriteInput;
    const parsed = {
        ...updates,
        ...normalizeMergedClientPricing(existing, updates),
        startDate: parseClientDate(updates.startDate, "startDate"),
        endDate: parseClientDate(updates.endDate, "endDate"),
        dueDate: parseClientDate(updates.dueDate, "dueDate"),
        birthDate: parseClientDate(updates.birthDate, "birthDate"),
    };
    const derived = validatedDerivedDuration(existing, parsed);
    // A contracted count is authoritative. Omission fills only an absent count;
    // it must never replace an existing count with the length of an extended period.
    const duration = parsed.duration !== undefined ? parsed.duration
        : existing.duration === null && derived !== null ? derived : undefined;
    return { ...parsed, ...(duration === undefined ? {} : { duration }) };
}
