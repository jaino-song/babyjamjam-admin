export const FETAL_TYPE_LABELS = {
  SINGLETON: "단태아",
  SEVERE_SINGLETON: "중증 단태아",
  TWINS: "쌍생아",
  SEVERE_TWINS: "중증 쌍태아",
  TRIPLETS: "삼태아",
  SEVERE_TRIPLETS_PLUS: "중증 삼태아 이상",
  QUADRUPLETS_PLUS: "사태아 이상",
} as const;

export const FETAL_TYPE_CONFIRMATION = {
  UNCONFIRMED: "UNCONFIRMED",
  CONFIRMED: "CONFIRMED",
} as const;

export const PROVIDER_SLOT_LABELS = {
  0: "주 제공인력",
  1: "보조 제공인력 1",
  2: "보조 제공인력 2",
  3: "보조 제공인력 3",
} as const;

export type FetalType = keyof typeof FETAL_TYPE_LABELS;
export type FetalTypeConfirmation = keyof typeof FETAL_TYPE_CONFIRMATION;
export type ProviderSlot = keyof typeof PROVIDER_SLOT_LABELS;
type VoucherFamily = "A" | "B" | "C" | "D";

export interface VoucherAllocationCode {
  readonly family: VoucherFamily;
  readonly grade: "가" | "통합" | "라";
  readonly subcode: 1 | 2 | 3;
  readonly code: string;
}

export type VoucherCodeCatalog = Readonly<Partial<Record<number, readonly string[]>>>;

type NonAdmissionReason = "missing-year" | "invalid-year" | "missing-catalog"
  | "missing-code" | "invalid-code" | "code-not-in-year";

export type VoucherAdmission =
  | { admitted: true; issuanceYear: number; voucher: VoucherAllocationCode }
  | { admitted: false; reason: NonAdmissionReason };

const SUBCODES = { 1: 1, 2: 2, 3: 3, "①": 1, "②": 2, "③": 3 } as const;

function parseVoucherCode(code: string): VoucherAllocationCode | null {
  const match = /^([ABCD])-?(가|통합|라)-?([123①②③])형$/.exec(code.trim());
  if (!match) return null;

  const family = match[1] as VoucherFamily;
  const grade = match[2] as VoucherAllocationCode["grade"];
  const subcode = SUBCODES[match[3] as keyof typeof SUBCODES];
  if (family !== "A" && subcode === 3) return null;

  return { family, grade, subcode, code: `${family}${grade}${subcode}형` };
}

export function admitVoucherCode(
  code: string | null | undefined,
  issuanceYear: number | null | undefined,
  catalog: VoucherCodeCatalog | null | undefined,
): VoucherAdmission {
  if (issuanceYear == null) return { admitted: false, reason: "missing-year" };
  if (!Number.isSafeInteger(issuanceYear) || issuanceYear < 1) {
    return { admitted: false, reason: "invalid-year" };
  }
  const yearCodes = catalog && Object.prototype.hasOwnProperty.call(catalog, issuanceYear)
    ? catalog[issuanceYear]
    : undefined;
  if (!Array.isArray(yearCodes)) return { admitted: false, reason: "missing-catalog" };
  if (code == null) return { admitted: false, reason: "missing-code" };
  if (typeof code !== "string") return { admitted: false, reason: "invalid-code" };
  if (code.trim() === "") return { admitted: false, reason: "missing-code" };

  const voucher = parseVoucherCode(code);
  if (!voucher) return { admitted: false, reason: "invalid-code" };
  if (!yearCodes.some((entry) => typeof entry === "string" && parseVoucherCode(entry)?.code === voucher.code)) {
    return { admitted: false, reason: "code-not-in-year" };
  }

  return { admitted: true, issuanceYear, voucher };
}

export type FetalTypeOption = { readonly fetalType: FetalType; readonly label: string } & (
  | { readonly babyCount: number }
  | { readonly minimumBabyCount: number }
);

const FETAL_TYPES_BY_FAMILY = {
  A: ["SINGLETON"],
  B: ["SEVERE_SINGLETON", "TWINS"],
  C: ["SEVERE_TWINS", "TRIPLETS"],
  D: ["SEVERE_TRIPLETS_PLUS", "QUADRUPLETS_PLUS"],
} as const satisfies Record<VoucherFamily, readonly FetalType[]>;

const BABY_COUNTS = {
  SINGLETON: { babyCount: 1 },
  SEVERE_SINGLETON: { babyCount: 1 },
  TWINS: { babyCount: 2 },
  SEVERE_TWINS: { babyCount: 2 },
  TRIPLETS: { babyCount: 3 },
  SEVERE_TRIPLETS_PLUS: { minimumBabyCount: 3 },
  QUADRUPLETS_PLUS: { minimumBabyCount: 4 },
} as const;

const PROVIDER_CAPACITY = {
  A: { 1: 1, 2: 1, 3: 1 },
  B: { 1: 1, 2: 2 },
  C: { 1: 2, 2: 3 },
  D: { 1: 2, 2: 4 },
} as const;

const PROVIDER_SLOTS = [0, 1, 2, 3] as const;

export interface BabyRecordProviderInput {
  readonly slot: ProviderSlot;
  readonly employeeId: number | null;
  /** 직원이 배정 슬롯에 남아 있지만 담당할 수 없는 경우 false. */
  readonly enabled?: boolean;
}

export interface ExistingBaby {
  readonly babyId: string;
  readonly ordinal: number;
}

export type BabyRecordAssignmentInput = { readonly providerSlot: ProviderSlot } & (
  | { readonly babyId: string; readonly ordinal?: never }
  | { readonly ordinal: number; readonly babyId?: never }
);

type VoucherAllocationInput = {
  readonly service: "voucher";
  readonly code?: string | null;
  readonly issuanceYear?: number | null;
  readonly catalog?: VoucherCodeCatalog | null;
  readonly fetalType?: FetalType | null;
  readonly babyCount?: number | null;
  readonly providers?: readonly BabyRecordProviderInput[];
  /** 이 등록 건에 속한 활성 아기의 저장된 ID와 순번. 담당 요청에서 가져오지 않는다. */
  readonly babies?: readonly ExistingBaby[];
  readonly babyAssignments?: readonly BabyRecordAssignmentInput[];
};

export type BabyRecordAllocationInput = { readonly service: "non-voucher" } | (VoucherAllocationInput & (
  | { readonly mode: "submission" }
  | { readonly mode: "legacy"; readonly confirmation?: FetalTypeConfirmation | null }
));

export interface BabyRecordAllocationRules {
  readonly voucher: VoucherAllocationCode;
  readonly fetalTypeOptions: readonly FetalTypeOption[];
  readonly providerCapacity: 1 | 2 | 3 | 4;
}

export interface BabyRecordProviderSlot {
  readonly slot: ProviderSlot;
  readonly label: string;
  readonly enabled: boolean;
  readonly employeeId: number | null;
  readonly available: boolean;
}

export interface BabyRecordAssignment {
  readonly babyId: string | null;
  readonly ordinal: number;
  readonly providerSlot: ProviderSlot | null;
  readonly employeeId: number | null;
  readonly source: "explicit" | "default" | "unassigned";
  readonly canChangeProvider: boolean;
  readonly availableProviderSlots: readonly ProviderSlot[];
}

export type BabyRecordAllocationIssue =
  | { field: "voucher"; code: NonAdmissionReason }
  | { field: "confirmation"; code: "unconfirmed" }
  | { field: "fetalType"; code: "required" | "unsupported" }
  | { field: "babyCount"; code: "invalid-count" }
  | { field: "providers"; index: number; code: "disabled-slot" | "invalid-employee" | "duplicate-slot" | "duplicate-employee" }
  | { field: "babies"; index: number; code: "invalid-baby" | "duplicate-baby" | "duplicate-ordinal" }
  | { field: "babyAssignments"; index: number; code: "unknown-baby" | "invalid-target" | "baby-id-required" | "duplicate-ordinal" | "unavailable-slot" | "fixed-primary" };

export type BabyRecordAllocation =
  | { status: "not-applicable"; confirmation: "UNCONFIRMED"; rules: null }
  | { status: "invalid" | "unconfirmed"; confirmation: "UNCONFIRMED"; rules: BabyRecordAllocationRules | null; issue: BabyRecordAllocationIssue }
  | {
    status: "resolved";
    confirmation: "CONFIRMED";
    rules: BabyRecordAllocationRules;
    fetalType: FetalType;
    babyCount: number;
    providerSlots: readonly BabyRecordProviderSlot[];
    assignmentFor: (ordinal: number) => BabyRecordAssignment | null;
  };

function isBabyOrdinal(ordinal: number, babyCount: number): boolean {
  return Number.isSafeInteger(ordinal) && ordinal >= 1 && ordinal <= babyCount;
}

function canChangeProvider(fetalType: FetalType, ordinal: number): boolean {
  return fetalType === "SEVERE_SINGLETON" || ordinal > 1;
}

/** 임시저장에도 사용할 수 있게 인력과 담당이 비어 있는 상태를 허용한다. */
export function resolveBabyRecordAllocation(input: BabyRecordAllocationInput): BabyRecordAllocation {
  if (input.service === "non-voucher") {
    return { status: "not-applicable", confirmation: "UNCONFIRMED", rules: null };
  }

  let rules: BabyRecordAllocationRules | null = null;
  const reject = (issue: BabyRecordAllocationIssue): BabyRecordAllocation => ({
    status: input.mode === "legacy" ? "unconfirmed" : "invalid",
    confirmation: "UNCONFIRMED",
    rules,
    issue,
  });

  const admission = admitVoucherCode(input.code, input.issuanceYear, input.catalog);
  if (!admission.admitted) return reject({ field: "voucher", code: admission.reason });

  const { voucher } = admission;
  const fetalTypeOptions: FetalTypeOption[] = FETAL_TYPES_BY_FAMILY[voucher.family].map((fetalType) => ({
    fetalType,
    label: FETAL_TYPE_LABELS[fetalType],
    ...BABY_COUNTS[fetalType],
  }));
  const providerCapacity = voucher.family === "A" ? PROVIDER_CAPACITY.A[voucher.subcode]
    : PROVIDER_CAPACITY[voucher.family][voucher.subcode as 1 | 2];
  rules = { voucher, fetalTypeOptions, providerCapacity };

  if (input.mode === "legacy" && input.confirmation !== "CONFIRMED") {
    return reject({ field: "confirmation", code: "unconfirmed" });
  }
  const fetalType = input.fetalType ?? (voucher.family === "A" ? "SINGLETON" : null);
  if (!fetalType) return reject({ field: "fetalType", code: "required" });
  const option = fetalTypeOptions.find((candidate) => candidate.fetalType === fetalType);
  if (!option) return reject({ field: "fetalType", code: "unsupported" });

  const babyCount = input.babyCount ?? ("babyCount" in option ? option.babyCount : 0);
  if (!Number.isSafeInteger(babyCount) || ("babyCount" in option
    ? babyCount !== option.babyCount
    : babyCount < option.minimumBabyCount)) {
    return reject({ field: "babyCount", code: "invalid-count" });
  }

  const providers = new Map<ProviderSlot, BabyRecordProviderInput>();
  const employeeIds = new Set<number>();
  for (const [index, provider] of (input.providers ?? []).entries()) {
    const { slot, employeeId } = provider;
    if (!PROVIDER_SLOTS.includes(slot) || (slot >= providerCapacity && employeeId !== null)) {
      return reject({ field: "providers", index, code: "disabled-slot" });
    }
    if (providers.has(slot)) return reject({ field: "providers", index, code: "duplicate-slot" });
    if (employeeId !== null) {
      if (!Number.isSafeInteger(employeeId) || employeeId < 1) {
        return reject({ field: "providers", index, code: "invalid-employee" });
      }
      if (employeeIds.has(employeeId)) return reject({ field: "providers", index, code: "duplicate-employee" });
      employeeIds.add(employeeId);
    }
    providers.set(slot, provider);
  }

  const providerSlots = PROVIDER_SLOTS.map((slot): BabyRecordProviderSlot => {
    const provider = providers.get(slot);
    const enabled = slot < providerCapacity;
    const employeeId = provider?.employeeId ?? null;
    return {
      slot,
      label: PROVIDER_SLOT_LABELS[slot],
      enabled,
      employeeId,
      available: enabled && employeeId !== null && provider?.enabled !== false,
    };
  });
  const availableSlots = providerSlots.filter(({ available }) => available).map(({ slot }) => slot);

  const ordinalByBabyId = new Map<string, number>();
  const babyIdByOrdinal = new Map<number, string>();
  for (const [index, { babyId, ordinal }] of (input.babies ?? []).entries()) {
    if (typeof babyId !== "string" || !babyId.trim() || !isBabyOrdinal(ordinal, babyCount)) {
      return reject({ field: "babies", index, code: "invalid-baby" });
    }
    if (ordinalByBabyId.has(babyId)) return reject({ field: "babies", index, code: "duplicate-baby" });
    if (babyIdByOrdinal.has(ordinal)) return reject({ field: "babies", index, code: "duplicate-ordinal" });
    ordinalByBabyId.set(babyId, ordinal);
    babyIdByOrdinal.set(ordinal, babyId);
  }

  const explicitSlots = new Map<number, ProviderSlot>();
  for (const [index, assignment] of (input.babyAssignments ?? []).entries()) {
    const { babyId, providerSlot } = assignment;
    const field = "babyAssignments" as const;
    const ordinal = babyId === undefined ? assignment.ordinal : ordinalByBabyId.get(babyId);
    if (babyId !== undefined && ordinal === undefined) return reject({ field, index, code: "unknown-baby" });
    if (ordinal === undefined || !isBabyOrdinal(ordinal, babyCount)
      || (babyId !== undefined && assignment.ordinal !== undefined)) {
      return reject({ field, index, code: "invalid-target" });
    }
    if (babyId === undefined && babyIdByOrdinal.has(ordinal)) return reject({ field, index, code: "baby-id-required" });
    if (explicitSlots.has(ordinal)) return reject({ field, index, code: "duplicate-ordinal" });
    if (!availableSlots.includes(providerSlot)) return reject({ field, index, code: "unavailable-slot" });
    if (!canChangeProvider(fetalType, ordinal) && providerSlot !== 0) {
      return reject({ field, index, code: "fixed-primary" });
    }
    explicitSlots.set(ordinal, providerSlot);
  }

  return {
    status: "resolved",
    confirmation: "CONFIRMED",
    rules,
    fetalType,
    babyCount,
    providerSlots,
    assignmentFor(ordinal) {
      if (!isBabyOrdinal(ordinal, babyCount)) return null;

      const changeable = canChangeProvider(fetalType, ordinal);
      const explicitSlot = explicitSlots.get(ordinal);
      const matchingSlot = PROVIDER_SLOTS[ordinal - 1];
      const defaultSlot = matchingSlot !== undefined && availableSlots.includes(matchingSlot)
        ? matchingSlot
        : availableSlots.includes(0) ? 0 : null;
      const providerSlot = explicitSlot ?? defaultSlot;

      return {
        babyId: babyIdByOrdinal.get(ordinal) ?? null,
        ordinal,
        providerSlot,
        employeeId: providerSlot === null ? null : providerSlots[providerSlot].employeeId,
        source: explicitSlot !== undefined ? "explicit" : providerSlot === null ? "unassigned" : "default",
        canChangeProvider: changeable,
        availableProviderSlots: changeable ? [...availableSlots] : availableSlots.filter((slot) => slot === 0),
      };
    },
  };
}
