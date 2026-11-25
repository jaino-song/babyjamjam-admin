import {
  admitVoucherCode,
  FETAL_TYPE_CONFIRMATION,
  FETAL_TYPE_LABELS,
  PROVIDER_SLOT_LABELS,
  resolveBabyRecordAllocation,
  type BabyRecordAllocationInput,
  type BabyRecordAssignmentInput,
  type ExistingBaby,
  type FetalType,
  type ProviderSlot,
} from "./baby-record-allocation";

const catalog = {
  2025: ["A통합1형"],
  2026: ["A통합1형", "A가2형", "A라3형", "B가1형", "B통합2형", "C라1형", "C가2형", "D통합1형", "D라2형"],
};

const submission = {
  service: "voucher",
  mode: "submission",
  issuanceYear: 2026,
  catalog,
} as const;

function resolve(input: Extract<BabyRecordAllocationInput, { service: "voucher" }>) {
  const result = resolveBabyRecordAllocation(input);
  if (result.status !== "resolved") throw new Error(JSON.stringify(result));
  return result;
}

describe("voucher code admission", () => {
  it.each([
    ["A통합1형", "A통합1형"],
    ["A통합-1형", "A통합1형"],
    ["A-통합1형", "A통합1형"],
    [" A-통합-①형 \n", "A통합1형"],
    ["B-통합-②형", "B통합2형"],
    ["C라-1형", "C라1형"],
    ["A-라③형", "A라3형"],
  ])("admits %s as %s", (code, canonical) => {
    expect(admitVoucherCode(code, 2026, catalog)).toMatchObject({
      admitted: true,
      issuanceYear: 2026,
      voucher: { code: canonical },
    });
  });

  it("matches catalog entries by canonical code without conflating grades", () => {
    const compact = admitVoucherCode("B통합2형", 2026, { 2026: [" B-통합-②형 "] });
    expect(compact).toMatchObject({ voucher: { family: "B", grade: "통합", subcode: 2 } });
    expect(admitVoucherCode("B통합2형", 2026, { 2026: ["B가2형"] })).toEqual({
      admitted: false,
      reason: "code-not-in-year",
    });
  });

  it.each([
    "A 통합1형", "A통합 1형", "A-통합-1 형", "A\n통합1형", "A통합--1형", "A통합–1형",
    "A통합1형!", "a통합1형", "E통합1형", "A나1형", "A통합1", "A통합01형",
    "A통합④형", "B가3형", "C라3형", "D통합③형",
  ])("rejects invalid syntax even if the catalog includes %s", (code) => {
    expect(admitVoucherCode(code, 2026, { 2026: [code] })).toEqual({ admitted: false, reason: "invalid-code" });
  });

  it("admits the same valid code for one year and rejects it for another", () => {
    expect(admitVoucherCode("B통합2형", 2026, catalog)).toMatchObject({ admitted: true });
    expect(admitVoucherCode("B통합2형", 2025, catalog)).toEqual({ admitted: false, reason: "code-not-in-year" });
  });

  it.each([
    ["missing-year", "B통합2형", null, catalog],
    ["invalid-year", "B통합2형", 2026.5, catalog],
    ["missing-catalog", "B통합2형", 2026, null],
    ["missing-catalog", "B통합2형", 2027, catalog],
    ["missing-code", null, 2026, catalog],
    ["missing-code", " \t", 2026, catalog],
    ["code-not-in-year", "B통합2형", 2026, { 2026: [] }],
  ] as const)("reports %s explicitly for a submission and leaves legacy unresolved", (reason, code, issuanceYear, yearCatalog) => {
    expect(admitVoucherCode(code, issuanceYear, yearCatalog)).toEqual({ admitted: false, reason });
    const input = { ...submission, code, issuanceYear, catalog: yearCatalog };
    const issue = { field: "voucher", code: reason };

    expect(resolveBabyRecordAllocation(input)).toMatchObject({ status: "invalid", issue });
    expect(resolveBabyRecordAllocation({ ...input, mode: "legacy" })).toMatchObject({
      status: "unconfirmed", confirmation: "UNCONFIRMED", issue,
    });
  });

  it("requires the requested year to be present in the supplied catalog itself", () => {
    expect(admitVoucherCode("A통합1형", 2026, Object.create(catalog))).toEqual({
      admitted: false, reason: "missing-catalog",
    });
  });
});

describe("voucher staffing and baby counts", () => {
  it("uses the persisted Phase 1 codes and exact display labels", () => {
    expect(FETAL_TYPE_LABELS).toEqual({
      SINGLETON: "단태아",
      SEVERE_SINGLETON: "중증 단태아",
      TWINS: "쌍생아",
      SEVERE_TWINS: "중증 쌍태아",
      TRIPLETS: "삼태아",
      SEVERE_TRIPLETS_PLUS: "중증 삼태아 이상",
      QUADRUPLETS_PLUS: "사태아 이상",
    });
    expect(FETAL_TYPE_CONFIRMATION).toEqual({ UNCONFIRMED: "UNCONFIRMED", CONFIRMED: "CONFIRMED" });
    expect(PROVIDER_SLOT_LABELS).toEqual({
      0: "주 제공인력",
      1: "보조 제공인력 1",
      2: "보조 제공인력 2",
      3: "보조 제공인력 3",
    });
  });

  it.each([
    ["A통합1형", undefined, undefined, 1, 1, ["SINGLETON"]],
    ["A가2형", undefined, undefined, 1, 1, ["SINGLETON"]],
    ["A라3형", "SINGLETON", 1, 1, 1, ["SINGLETON"]],
    ["B가1형", "SEVERE_SINGLETON", undefined, 1, 1, ["SEVERE_SINGLETON", "TWINS"]],
    ["B통합2형", "SEVERE_SINGLETON", undefined, 1, 2, ["SEVERE_SINGLETON", "TWINS"]],
    ["B통합2형", "TWINS", undefined, 2, 2, ["SEVERE_SINGLETON", "TWINS"]],
    ["C라1형", "SEVERE_TWINS", undefined, 2, 2, ["SEVERE_TWINS", "TRIPLETS"]],
    ["C가2형", "TRIPLETS", undefined, 3, 3, ["SEVERE_TWINS", "TRIPLETS"]],
    ["D통합1형", "SEVERE_TRIPLETS_PLUS", 3, 3, 2, ["SEVERE_TRIPLETS_PLUS", "QUADRUPLETS_PLUS"]],
    ["D라2형", "QUADRUPLETS_PLUS", 4, 4, 4, ["SEVERE_TRIPLETS_PLUS", "QUADRUPLETS_PLUS"]],
    ["D라2형", "SEVERE_TRIPLETS_PLUS", 5, 5, 4, ["SEVERE_TRIPLETS_PLUS", "QUADRUPLETS_PLUS"]],
  ] as const)("resolves %s and %s with the expected count, options and capacity", (code, fetalType, count, babyCount, providerCapacity, options) => {
    const result = resolve({ ...submission, code, fetalType, babyCount: count });

    expect(result).toMatchObject({ confirmation: "CONFIRMED", babyCount, rules: { providerCapacity } });
    expect(result.fetalType).toBe(fetalType ?? "SINGLETON");
    expect(result.rules.fetalTypeOptions.map((option) => option.fetalType)).toEqual(options);
    expect(result.providerSlots.map(({ enabled, available }) => [enabled, available])).toEqual(
      [0, 1, 2, 3].map((slot) => [slot < providerCapacity, false]),
    );
  });

  it("exposes labels and minimum actual counts before a D type is selected", () => {
    expect(resolveBabyRecordAllocation({ ...submission, code: "D라2형" })).toMatchObject({
      status: "invalid",
      issue: { field: "fetalType", code: "required" },
      rules: {
        providerCapacity: 4,
        fetalTypeOptions: [
          { fetalType: "SEVERE_TRIPLETS_PLUS", label: "중증 삼태아 이상", minimumBabyCount: 3 },
          { fetalType: "QUADRUPLETS_PLUS", label: "사태아 이상", minimumBabyCount: 4 },
        ],
      },
    });
  });

  it.each([
    ["A가2형", "SEVERE_SINGLETON", 1, "unsupported"],
    ["B통합2형", "TRIPLETS", 3, "unsupported"],
    ["C라1형", "SINGLETON", 1, "unsupported"],
    ["D라2형", "TRIPLETS", 3, "unsupported"],
    ["B가1형", "TWINS", 1, "invalid-count"],
    ["B통합2형", "SEVERE_SINGLETON", 2, "invalid-count"],
    ["D라2형", "QUADRUPLETS_PLUS", undefined, "invalid-count"],
    ["D라2형", "QUADRUPLETS_PLUS", 3, "invalid-count"],
    ["D통합1형", "SEVERE_TRIPLETS_PLUS", 2, "invalid-count"],
    ["D라2형", "QUADRUPLETS_PLUS", 4.5, "invalid-count"],
    ["D라2형", "QUADRUPLETS_PLUS", Infinity, "invalid-count"],
    ["D라2형", "QUADRUPLETS_PLUS", Number.MAX_SAFE_INTEGER + 1, "invalid-count"],
  ] as const)("rejects %s and %s with count %s", (code, fetalType, babyCount, issueCode) => {
    expect(resolveBabyRecordAllocation({ ...submission, code, fetalType, babyCount })).toMatchObject({
      status: "invalid", issue: { code: issueCode },
    });
  });

  it.each(["A통합1형", "B가1형", "C라1형", "D라2형"])("reads legacy null confirmation as unconfirmed for %s", (code) => {
    expect(resolveBabyRecordAllocation({ ...submission, mode: "legacy", code, confirmation: null })).toMatchObject({
      status: "unconfirmed", confirmation: "UNCONFIRMED", issue: { field: "confirmation", code: "unconfirmed" },
    });
  });

  it("does not infer a B family's baby count even with a confirmed flag and reads explicitly confirmed values", () => {
    const input = { ...submission, mode: "legacy", code: "B통합2형", confirmation: "CONFIRMED" } as const;
    expect(resolveBabyRecordAllocation(input)).toMatchObject({
      status: "unconfirmed", issue: { field: "fetalType", code: "required" },
    });
    expect(resolve({ ...input, fetalType: "TWINS" })).toMatchObject({ babyCount: 2, confirmation: "CONFIRMED" });
    expect(resolve({ ...input, code: "A가2형" })).toMatchObject({ babyCount: 1, confirmation: "CONFIRMED" });
  });

  it.each(["B1형", "B기타1형"])("leaves legacy missing or unknown grades unresolved for %s", (code) => {
    expect(resolveBabyRecordAllocation({ ...submission, mode: "legacy", code, confirmation: "CONFIRMED" })).toEqual({
      status: "unconfirmed", confirmation: "UNCONFIRMED", rules: null,
      issue: { field: "voucher", code: "invalid-code" },
    });
  });

  it("reports a distinct safe result for a non-voucher client", () => {
    expect(resolveBabyRecordAllocation({ service: "non-voucher" })).toEqual({
      status: "not-applicable", confirmation: "UNCONFIRMED", rules: null,
    });
  });
});

describe("per-baby record ownership", () => {
  const primary = { slot: 0, employeeId: 101 } as const;
  const assistant = { slot: 1, employeeId: 102 } as const;
  const twins = { ...submission, code: "B통합2형", fetalType: "TWINS" } as const;
  const dVoucher = { ...submission, code: "D라2형", fetalType: "QUADRUPLETS_PLUS" } as const;
  const fullRoster = [primary, assistant, { slot: 2, employeeId: 103 }, { slot: 3, employeeId: 104 }] as const;

  it("defaults a severe singleton to primary and restores an explicit assistant selection from a draft", () => {
    const draft = {
      ...submission,
      code: "B통합2형",
      fetalType: "SEVERE_SINGLETON",
      providers: [primary, assistant],
    } as const;
    expect(resolve(draft).assignmentFor(1)).toEqual({
      babyId: null, ordinal: 1, providerSlot: 0, employeeId: 101, source: "default",
      canChangeProvider: true, availableProviderSlots: [0, 1],
    });

    const selected = { ...draft, providers: [assistant], babyAssignments: [{ ordinal: 1, providerSlot: 1 }] } as const;
    const restored: typeof selected = JSON.parse(JSON.stringify(selected));
    const result = resolve(restored);
    expect(result.babyCount).toBe(1);
    expect(result.assignmentFor(1)).toMatchObject({ providerSlot: 1, employeeId: 102, source: "explicit" });
    expect(result.assignmentFor(2)).toBeNull();
  });

  it("retains a saved override by stable baby ID when provider entries are reordered", () => {
    const babies = [{ babyId: "baby-2", ordinal: 2 }, { babyId: "baby-1", ordinal: 1 }];
    const result = resolve({
      ...twins, babies, historicalMaxOrdinal: 2, providers: [assistant, primary],
      babyAssignments: [{ babyId: "baby-2", providerSlot: 0 }],
    });
    expect(result.assignmentFor(1)).toMatchObject({ babyId: "baby-1", employeeId: 101, canChangeProvider: false });
    expect(result.assignmentFor(2)).toMatchObject({ babyId: "baby-2", employeeId: 101, source: "explicit" });
  });

  it("allows one worker to own twins and keeps their two ordinals distinct", () => {
    const result = resolve({ ...twins, providers: [primary] });
    expect(result.assignmentFor(1)).toMatchObject({ ordinal: 1, providerSlot: 0, employeeId: 101 });
    expect(result.assignmentFor(2)).toMatchObject({ ordinal: 2, providerSlot: 0, employeeId: 101 });
  });

  it.each<FetalType>(["QUADRUPLETS_PLUS", "SEVERE_TRIPLETS_PLUS"])("uses only the staffed matching slots and primary fallback for five babies of type %s", (fetalType) => {
    const result = resolve({
      ...submission, code: "D라2형", fetalType, babyCount: 5,
      providers: [primary, { slot: 2, employeeId: 103 }, { slot: 3, employeeId: 104 }],
    });
    expect(result.providerSlots.map(({ label, employeeId }) => [label, employeeId])).toEqual([
      ["주 제공인력", 101], ["보조 제공인력 1", null], ["보조 제공인력 2", 103], ["보조 제공인력 3", 104],
    ]);
    expect([1, 2, 3, 4, 5].map((ordinal) => result.assignmentFor(ordinal)?.providerSlot)).toEqual([0, 0, 2, 3, 0]);
  });

  it.each([0, 1])("looks up a maximal safe count lazily with a historical maximum of %i", (historicalMaxOrdinal) => {
    const result = resolve({
      ...dVoucher, babyCount: Number.MAX_SAFE_INTEGER, providers: [primary], historicalMaxOrdinal,
      babies: historicalMaxOrdinal === 0 ? [] : [{ babyId: "baby-1", ordinal: 1 }],
    });
    expect(result.assignmentAtRank(Number.MAX_SAFE_INTEGER)).toMatchObject({
      ordinal: Number.MAX_SAFE_INTEGER, providerSlot: 0,
    });
    expect(result.assignmentAtRank(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(result.assignmentFor(Number.MAX_SAFE_INTEGER)).toMatchObject({ providerSlot: 0 });
    expect(result.assignmentFor(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  });

  it("keeps the first baby unassigned without a primary and assigns a staffed matching slot to the second", () => {
    const result = resolve({ ...twins, providers: [assistant] });
    expect(result.assignmentFor(1)).toMatchObject({
      providerSlot: null, employeeId: null, source: "unassigned", availableProviderSlots: [],
    });
    expect(result.assignmentFor(2)).toMatchObject({ providerSlot: 1, employeeId: 102, source: "default" });
    expect(resolve(twins).assignmentFor(2)).toMatchObject({ providerSlot: null, source: "unassigned" });
    expect(result.assignmentFor(0)).toBeNull();
    expect(result.assignmentFor(1.5)).toBeNull();
  });

  it("falls back from disabled staff and leaves a client with neither default unassigned", () => {
    const providers = [primary, { ...assistant, enabled: false }];
    expect(resolve({ ...twins, providers }).assignmentFor(2)).toMatchObject({
      providerSlot: 0, employeeId: 101, availableProviderSlots: [0],
    });
    const severeSingleton = resolve({ ...twins, fetalType: "SEVERE_SINGLETON", providers: [assistant] });
    expect(severeSingleton.assignmentFor(1)).toMatchObject({ providerSlot: null, availableProviderSlots: [1] });
    const primaryDisabled = resolve({ ...twins, providers: [{ ...primary, enabled: false }] });
    expect(primaryDisabled.assignmentFor(2)).toMatchObject({ providerSlot: null, source: "unassigned" });
  });

  it.each([
    [[primary, { slot: 0, employeeId: 102 }], "duplicate-slot"],
    [[primary, { slot: 1, employeeId: 101 }], "duplicate-employee"],
    [[{ slot: 2, employeeId: 103 }], "disabled-slot"],
    [[{ slot: 0, employeeId: 0 }], "invalid-employee"],
  ] as const)("rejects conflicting or invalid roster %j", (providers, code) => {
    expect(resolveBabyRecordAllocation({ ...twins, providers })).toMatchObject({
      status: "invalid", issue: { field: "providers", code },
    });
  });

  it.each([-1, 4])("rejects out-of-range provider slot %i even when unstaffed", (slot) => {
    expect(resolveBabyRecordAllocation({
      ...twins, providers: [primary, { slot: slot as ProviderSlot, employeeId: null }],
    })).toMatchObject({ status: "invalid", issue: { field: "providers", index: 1, code: "disabled-slot" } });
  });

  it.each([
    [[{ ordinal: 1, providerSlot: 1 }], [primary, assistant], "fixed-primary"],
    [[{ ordinal: 2, providerSlot: 1 }], [primary], "unavailable-slot"],
    [[{ ordinal: 2, providerSlot: 1 }], [primary, { ...assistant, enabled: false }], "unavailable-slot"],
    [[{ ordinal: 2, providerSlot: 2 }], [primary, assistant], "unavailable-slot"],
    [[{ ordinal: 2, providerSlot: 1 }, { ordinal: 2, providerSlot: 0 }], [primary, assistant], "duplicate-ordinal"],
    [[{ ordinal: 3, providerSlot: 0 }], [primary], "invalid-target"],
    [[{ babyId: "different-client-baby", providerSlot: 0 }], [primary], "unknown-baby"],
  ] as const)("rejects invalid explicit assignments %j", (babyAssignments, providers, code) => {
    expect(resolveBabyRecordAllocation({ ...twins, providers, babyAssignments })).toMatchObject({
      status: "invalid", issue: { field: "babyAssignments", code },
    });
  });

  it("rejects an assignment targeting both a saved baby ID and an ordinal", () => {
    const mixedTarget = { babyId: "baby-2", ordinal: 1, providerSlot: 1 };
    expect(resolveBabyRecordAllocation({
      ...twins,
      providers: [primary, assistant],
      babies: [{ babyId: "baby-1", ordinal: 1 }, { babyId: "baby-2", ordinal: 2 }],
      historicalMaxOrdinal: 2,
      babyAssignments: [mixedTarget as unknown as BabyRecordAssignmentInput],
    })).toMatchObject({ status: "invalid", issue: { field: "babyAssignments", index: 0, code: "invalid-target" } });
  });

  it.each([
    [[{ babyId: "baby-1", ordinal: 1 }, { babyId: "baby-1", ordinal: 2 }], "duplicate-baby"],
    [[{ babyId: "baby-1", ordinal: 2 }, { babyId: "baby-2", ordinal: 2 }], "duplicate-ordinal"],
  ] as const)("rejects conflicting existing identities %j", (babies, code) => {
    expect(resolveBabyRecordAllocation({ ...twins, babies, historicalMaxOrdinal: 2 })).toMatchObject({
      status: "invalid", issue: { field: "babies", code },
    });
  });

  it.each(["", " \t", 42])("rejects invalid persisted baby ID %j with a valid ordinal", (babyId) => {
    expect(resolveBabyRecordAllocation({
      ...twins, historicalMaxOrdinal: 2, babies: [{ babyId: "baby-1", ordinal: 1 }, { babyId: babyId as string, ordinal: 2 }],
    })).toMatchObject({ status: "invalid", issue: { field: "babies", index: 1, code: "invalid-baby" } });
  });

  it("requires persisted IDs for saved babies and rejects a second override for the same ID", () => {
    const saved = {
      ...twins, babies: [{ babyId: "baby-2", ordinal: 2 }], historicalMaxOrdinal: 2, providers: [primary, assistant],
    } as const;
    expect(resolveBabyRecordAllocation({ ...saved, babyAssignments: [{ ordinal: 2, providerSlot: 1 }] })).toMatchObject({
      status: "invalid", issue: { field: "babyAssignments", code: "baby-id-required" },
    });
    expect(resolveBabyRecordAllocation({
      ...saved, babyAssignments: [{ babyId: "baby-2", providerSlot: 0 }, { babyId: "baby-2", providerSlot: 1 }],
    })).toMatchObject({ status: "invalid", issue: { field: "babyAssignments", code: "duplicate-ordinal" } });
  });

  it("sorts twins with active ordinals 1 and 3 and assigns the assistant to the second active baby", () => {
    const result = resolve({
      ...twins, historicalMaxOrdinal: 3, providers: [primary, assistant],
      babies: [{ babyId: "baby-3", ordinal: 3 }, { babyId: "baby-1", ordinal: 1 }],
    });
    expect(result.assignmentAtRank(1)).toMatchObject({ babyId: "baby-1", ordinal: 1, providerSlot: 0 });
    expect(result.assignmentAtRank(2)).toEqual({
      babyId: "baby-3", ordinal: 3, providerSlot: 1, employeeId: 102, source: "default",
      canChangeProvider: true, availableProviderSlots: [0, 1],
    });
    expect(result.assignmentFor(3)).toEqual(result.assignmentAtRank(2));
    expect(result.assignmentFor(2)).toBeNull();
    for (const invalidRank of [0, 1.5, 3]) expect(result.assignmentAtRank(invalidRank)).toBeNull();
  });

  it("requires the historical maximum for a surviving twin at ordinal 3 and then allocates ordinal 4", () => {
    const saved = { ...twins, babies: [{ babyId: "baby-3", ordinal: 3 }], providers: [primary, assistant] };
    expect(resolveBabyRecordAllocation(saved)).toMatchObject({
      status: "invalid", issue: { field: "historicalMaxOrdinal", code: "required" },
    });

    const result = resolve({ ...saved, historicalMaxOrdinal: 3, babyAssignments: [{ ordinal: 4, providerSlot: 1 }] });
    expect(result.assignmentAtRank(1)).toMatchObject({
      babyId: "baby-3", ordinal: 3, providerSlot: 0, canChangeProvider: false,
    });
    expect(result.assignmentAtRank(2)).toMatchObject({ babyId: null, ordinal: 4, providerSlot: 1, source: "explicit" });
    expect(result.assignmentFor(1)).toBeNull();
    expect(result.assignmentFor(2)).toBeNull();
    expect(resolveBabyRecordAllocation({
      ...saved, historicalMaxOrdinal: 3, babyAssignments: [{ babyId: "baby-3", providerSlot: 1 }],
    })).toMatchObject({ status: "invalid", issue: { field: "babyAssignments", code: "fixed-primary" } });
  });

  it("uses active ranks for D② staffing and appends above numbers used by retired siblings", () => {
    const saved = {
      ...dVoucher, historicalMaxOrdinal: 7, providers: fullRoster,
      babies: [
        { babyId: "baby-5", ordinal: 5 }, { babyId: "baby-1", ordinal: 1 },
        { babyId: "baby-4", ordinal: 4 }, { babyId: "baby-2", ordinal: 2 },
      ],
    };
    const four = resolve({ ...saved, babyCount: 4 });
    expect([1, 2, 3, 4].map((rank) => four.assignmentAtRank(rank)?.ordinal)).toEqual([1, 2, 4, 5]);
    expect(four.assignmentFor(8)).toBeNull();

    const five = resolve({ ...saved, babyCount: 5 });
    const assignments = [1, 2, 3, 4, 5].map((rank) => five.assignmentAtRank(rank));
    expect(assignments.map((assignment) => assignment?.ordinal)).toEqual([1, 2, 4, 5, 8]);
    expect(assignments.map((assignment) => assignment?.providerSlot)).toEqual([0, 1, 2, 3, 0]);
    expect(five.assignmentFor(3)).toBeNull();
    expect(five.assignmentFor(7)).toBeNull();
    expect(five.assignmentFor(8)).toMatchObject({ babyId: null, providerSlot: 0 });
  });

  it("hydrates an explicit assignment by ID for a gapped ordinal", () => {
    const saved = {
      ...twins, mode: "legacy", confirmation: "CONFIRMED", historicalMaxOrdinal: 3,
      babies: [{ babyId: "baby-3", ordinal: 3 }, { babyId: "baby-1", ordinal: 1 }],
      babyAssignments: [{ babyId: "baby-3", providerSlot: 0 }],
      providers: [assistant, primary],
    } as const;
    const restored: typeof saved = JSON.parse(JSON.stringify(saved));
    expect(resolve(restored).assignmentAtRank(2)).toMatchObject({
      babyId: "baby-3", ordinal: 3, providerSlot: 0, employeeId: 101, source: "explicit",
    });
  });

  it("compacts the ranks of all survivors after the first baby retires", () => {
    const babies = [1, 2, 3, 4, 5].map((ordinal) => ({ babyId: `baby-${ordinal}`, ordinal }));
    const saved = { ...dVoucher, historicalMaxOrdinal: 5, providers: fullRoster };
    const before = resolve({ ...saved, babyCount: 5, babies });
    const after = resolve({ ...saved, babyCount: 4, babies: babies.slice(1) });
    for (const [index, { babyId, ordinal }] of babies.slice(1).entries()) {
      expect(before.assignmentAtRank(index + 2)).toMatchObject({ babyId, ordinal });
      expect(after.assignmentAtRank(index + 1)).toMatchObject({ babyId, ordinal, providerSlot: index });
    }
    expect(after.assignmentFor(1)).toBeNull();
  });

  it("keeps a persisted severe singleton changeable and unassigned when primary is absent", () => {
    const saved = {
      ...twins, fetalType: "SEVERE_SINGLETON", historicalMaxOrdinal: 5,
      babies: [{ babyId: "baby-5", ordinal: 5 }], providers: [assistant],
    } as const;
    expect(resolve(saved).assignmentAtRank(1)).toEqual({
      babyId: "baby-5", ordinal: 5, providerSlot: null, employeeId: null, source: "unassigned",
      canChangeProvider: true, availableProviderSlots: [1],
    });
    expect(resolve({ ...saved, babyAssignments: [{ babyId: "baby-5", providerSlot: 1 }] })
      .assignmentFor(5)).toMatchObject({ providerSlot: 1, source: "explicit" });
  });

  it("starts above retired history with no active rows and allocates multiple new siblings", () => {
    const result = resolve({ ...twins, babies: [], historicalMaxOrdinal: 5, providers: [primary, assistant] });
    expect(result.assignmentAtRank(1)).toMatchObject({ babyId: null, ordinal: 6, providerSlot: 0 });
    expect(result.assignmentAtRank(2)).toMatchObject({ babyId: null, ordinal: 7, providerSlot: 1 });
    expect(result.assignmentFor(5)).toBeNull();
  });

  it.each([
    [{ babyId: "retired-baby", providerSlot: 0 }, "unknown-baby"],
    [{ ordinal: 2, providerSlot: 0 }, "invalid-target"],
    [{ ordinal: 7, providerSlot: 0 }, "invalid-target"],
    [{ ordinal: 3, providerSlot: 0 }, "baby-id-required"],
  ] as const)("rejects an override against an invalid or persisted ordinal target %j", (assignment, code) => {
    expect(resolveBabyRecordAllocation({
      ...twins, historicalMaxOrdinal: 5, babies: [{ babyId: "baby-3", ordinal: 3 }],
      providers: [primary, assistant], babyAssignments: [assignment],
    })).toMatchObject({ status: "invalid", issue: { field: "babyAssignments", index: 0, code } });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid persisted ordinal %s", (ordinal) => {
    expect(resolveBabyRecordAllocation({
      ...twins, historicalMaxOrdinal: 3, babies: [{ babyId: "baby-1", ordinal }],
    })).toMatchObject({ status: "invalid", issue: { field: "babies", index: 0, code: "invalid-baby" } });
  });

  it("rejects a null row received in persisted data", () => {
    const babies: ExistingBaby[] = JSON.parse("[null]");
    expect(resolveBabyRecordAllocation({ ...twins, historicalMaxOrdinal: 3, babies })).toMatchObject({
      status: "invalid", issue: { field: "babies", index: 0, code: "invalid-baby" },
    });
  });

  it.each([
    ["negative", -1], ["unsafe", Number.MAX_SAFE_INTEGER + 1], ["too low", 2], ["fractional", 3.5],
  ] as const)("rejects a %s historical maximum", (_reason, historicalMaxOrdinal) => {
    expect(resolveBabyRecordAllocation({
      ...twins, historicalMaxOrdinal, babies: [{ babyId: "baby-3", ordinal: 3 }],
    })).toMatchObject({ status: "invalid", issue: { field: "historicalMaxOrdinal", code: "invalid-ordinal" } });
  });

  it("rejects a negative historical maximum even when no active rows are supplied", () => {
    expect(resolveBabyRecordAllocation({ ...twins, babies: [], historicalMaxOrdinal: -1 })).toMatchObject({
      status: "invalid", issue: { field: "historicalMaxOrdinal", code: "invalid-ordinal" },
    });
  });

  it("rejects more active rows than the baby count", () => {
    expect(resolveBabyRecordAllocation({
      ...twins, historicalMaxOrdinal: 4,
      babies: [{ babyId: "baby-1", ordinal: 1 }, { babyId: "baby-3", ordinal: 3 }, { babyId: "baby-4", ordinal: 4 }],
    })).toMatchObject({ status: "invalid", issue: { field: "babies", index: 2, code: "invalid-baby" } });
  });

  it("rejects adding a baby above the safe ordinal range", () => {
    const ordinal = Number.MAX_SAFE_INTEGER;
    const saved = {
      ...twins, historicalMaxOrdinal: ordinal, babies: [{ babyId: "last-baby", ordinal }],
    };
    expect(resolveBabyRecordAllocation(saved)).toMatchObject({
      status: "invalid", issue: { field: "babyCount", code: "invalid-count" },
    });
    expect(resolve({ ...saved, fetalType: "SEVERE_SINGLETON" }).assignmentAtRank(1)).toMatchObject({ ordinal });
  });
});
