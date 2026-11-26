export declare const FETAL_TYPE_LABELS: {
    readonly SINGLETON: "단태아";
    readonly SEVERE_SINGLETON: "중증 단태아";
    readonly TWINS: "쌍생아";
    readonly SEVERE_TWINS: "중증 쌍태아";
    readonly TRIPLETS: "삼태아";
    readonly SEVERE_TRIPLETS_PLUS: "중증 삼태아 이상";
    readonly QUADRUPLETS_PLUS: "사태아 이상";
};
export declare const FETAL_TYPE_CONFIRMATION: {
    readonly UNCONFIRMED: "UNCONFIRMED";
    readonly CONFIRMED: "CONFIRMED";
};
export declare const PROVIDER_SLOT_LABELS: {
    readonly 0: "주 제공인력";
    readonly 1: "보조 제공인력 1";
    readonly 2: "보조 제공인력 2";
    readonly 3: "보조 제공인력 3";
};
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
type NonAdmissionReason = "missing-year" | "invalid-year" | "missing-catalog" | "missing-code" | "invalid-code" | "code-not-in-year";
export type VoucherAdmission = {
    admitted: true;
    issuanceYear: number;
    voucher: VoucherAllocationCode;
} | {
    admitted: false;
    reason: NonAdmissionReason;
};
export declare function admitVoucherCode(code: string | null | undefined, issuanceYear: number | null | undefined, catalog: VoucherCodeCatalog | null | undefined): VoucherAdmission;
export type FetalTypeOption = {
    readonly fetalType: FetalType;
    readonly label: string;
} & ({
    readonly babyCount: number;
} | {
    readonly minimumBabyCount: number;
});
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
export type BabyRecordAssignmentInput = {
    readonly providerSlot: ProviderSlot;
} & ({
    readonly babyId: string;
    readonly ordinal?: never;
} | {
    readonly ordinal: number;
    readonly babyId?: never;
});
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
    /** 비활성 아기를 포함해 지금까지 발급한 가장 큰 저장 순번. 저장 이력이 없는 경우에만 생략할 수 있다. */
    readonly historicalMaxOrdinal?: number;
    readonly babyAssignments?: readonly BabyRecordAssignmentInput[];
};
export type BabyRecordAllocationInput = {
    readonly service: "non-voucher";
} | (VoucherAllocationInput & ({
    readonly mode: "submission";
} | {
    readonly mode: "legacy";
    readonly confirmation?: FetalTypeConfirmation | null;
}));
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
export type BabyRecordAllocationIssue = {
    field: "voucher";
    code: NonAdmissionReason;
} | {
    field: "confirmation";
    code: "unconfirmed";
} | {
    field: "fetalType";
    code: "required" | "unsupported";
} | {
    field: "babyCount";
    code: "invalid-count";
} | {
    field: "providers";
    index: number;
    code: "disabled-slot" | "invalid-employee" | "duplicate-slot" | "duplicate-employee";
} | {
    field: "babies";
    index: number;
    code: "invalid-baby" | "duplicate-baby" | "duplicate-ordinal";
} | {
    field: "historicalMaxOrdinal";
    code: "required" | "invalid-ordinal";
} | {
    field: "babyAssignments";
    index: number;
    code: "unknown-baby" | "invalid-target" | "baby-id-required" | "duplicate-ordinal" | "unavailable-slot" | "fixed-primary";
};
export type BabyRecordAllocation = {
    status: "not-applicable";
    confirmation: "UNCONFIRMED";
    rules: null;
} | {
    status: "invalid" | "unconfirmed";
    confirmation: "UNCONFIRMED";
    rules: BabyRecordAllocationRules | null;
    issue: BabyRecordAllocationIssue;
} | {
    status: "resolved";
    confirmation: "CONFIRMED";
    rules: BabyRecordAllocationRules;
    fetalType: FetalType;
    babyCount: number;
    providerSlots: readonly BabyRecordProviderSlot[];
    /** 저장 순번으로 조회한다. 비활성 순번은 null이다. */
    assignmentFor: (ordinal: number) => BabyRecordAssignment | null;
    /** 출생 순서대로 정렬한 활성 아기를 1부터 babyCount까지 조회한다. */
    assignmentAtRank: (rank: number) => BabyRecordAssignment | null;
};
/** 임시저장에도 사용할 수 있게 인력과 담당이 비어 있는 상태를 허용한다. */
export declare function resolveBabyRecordAllocation(input: BabyRecordAllocationInput): BabyRecordAllocation;
export {};
