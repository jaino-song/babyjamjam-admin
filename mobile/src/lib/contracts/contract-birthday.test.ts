import {
  buildContractClientPrefill,
  buildContractCreationPrefillFromClient,
} from "./contract-client-prefill";

const now = new Date("2026-09-07T12:00:00+09:00");

describe("mobile contract birthday prefill", () => {
  it.each([
    ["1990.1.2", "900102"],
    ["19900102", "900102"],
    ["90-01-02", "900102"],
    ["90/1/2", "900102"],
  ])("normalizes %s to %s", (raw, expected) => {
    const clientPrefill = buildContractClientPrefill({
      name: "홍길동",
      birthday: raw,
      dueDate: "260908",
      startDate: "260901",
      endDate: "260915",
    }, now);
    const creationPrefill = buildContractCreationPrefillFromClient({
      clientPrefill,
      dueDate: "2026-09-08",
      startDate: "2026-09-01",
      endDate: "2026-09-15",
      paymentDate: "2026-08-20",
    });

    expect(clientPrefill).toMatchObject({
      birthday: expected,
      dueDate: "260908",
      startDate: "260901",
      endDate: "260915",
    });
    expect(creationPrefill).toMatchObject({
      birthday: expected,
      dueDate: "2026-09-08",
      startDate: "2026-09-01",
      endDate: "2026-09-15",
    });
  });

  it.each([
    "1990.2.30",
    "2026-09-08",
    "900102-2123456",
  ])("rejects invalid or ambiguous birthday %s", (raw) => {
    const clientPrefill = buildContractClientPrefill({
      birthday: raw,
      dueDate: "260908",
      startDate: "260901",
      endDate: "260915",
    }, now);
    const creationPrefill = buildContractCreationPrefillFromClient({
      clientPrefill,
      dueDate: "2026-09-08",
      startDate: "2026-09-01",
      endDate: "2026-09-15",
      paymentDate: "2026-08-20",
    });

    expect(clientPrefill.birthday).toBeUndefined();
    expect(clientPrefill).toMatchObject({
      dueDate: "260908",
      startDate: "260901",
      endDate: "260915",
    });
    expect(creationPrefill.birthday).toBeUndefined();
    expect(creationPrefill).toMatchObject({
      dueDate: "2026-09-08",
      startDate: "2026-09-01",
      endDate: "2026-09-15",
    });
  });
});
