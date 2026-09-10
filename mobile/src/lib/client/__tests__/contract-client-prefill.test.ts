import type { EformsignContractClientCandidateResponse } from "@babyjamjam/shared/types/eformsign";

import { contractCandidateToClientPrefill } from "../contract-client-prefill";

const baseCandidate: EformsignContractClientCandidateResponse = {
  documentId: "doc-1",
  extracted: true,
  name: "홍길동",
  phone: "010-1234-5678",
  address: "서울시 강남구",
  birthday: "900101",
  dueDate: "2026-09-01",
  startDate: "2026-08-10",
  endDate: "2026-08-24",
  primaryEmployeeId: 17,
  secondaryEmployeeId: 23,
  type: "A통합-3형",
  duration: 10,
  fullPrice: "1000000",
  grant: "800000",
  actualPrice: "200000",
  careCenter: true,
  voucherClient: true,
  breastPump: false,
};

describe("contractCandidateToClientPrefill", () => {
  it("maps every candidate field, including employee IDs and false flags", () => {
    expect(contractCandidateToClientPrefill(
      baseCandidate,
      new Date("2026-08-20T12:00:00+09:00"),
    )).toEqual({
      name: "홍길동",
      phone: "010-1234-5678",
      address: "서울시 강남구",
      birthday: "900101",
      dueDate: "2026-09-01",
      startDate: "2026-08-10",
      endDate: "2026-08-24",
      primaryEmployeeId: 17,
      secondaryEmployeeId: 23,
      type: "A통합-3형",
      duration: 10,
      fullPrice: "1000000",
      grant: "800000",
      actualPrice: "200000",
      careCenter: true,
      voucherClient: true,
      breastPump: false,
      serviceStatus: "active",
    });
  });

  it("normalizes an international phone and keeps zero prices and null defaults", () => {
    expect(contractCandidateToClientPrefill(
      {
        ...baseCandidate,
        name: null,
        phone: "+82 10 9876 5432",
        address: null,
        birthday: null,
        dueDate: null,
        startDate: "2026-08-20",
        endDate: null,
        primaryEmployeeId: null,
        secondaryEmployeeId: null,
        type: null,
        duration: null,
        fullPrice: "0",
        grant: "0",
        actualPrice: "0",
        careCenter: null,
        voucherClient: false,
        breastPump: false,
      },
      new Date("2026-08-20T12:00:00+09:00"),
    )).toEqual({
      name: "",
      phone: "010-9876-5432",
      address: "",
      birthday: "",
      dueDate: "",
      startDate: "2026-08-20",
      endDate: "",
      primaryEmployeeId: null,
      secondaryEmployeeId: null,
      type: "",
      duration: null,
      fullPrice: "0",
      grant: "0",
      actualPrice: "0",
      careCenter: false,
      voucherClient: false,
      breastPump: false,
      serviceStatus: "pre_booking",
    });
  });

  it("marks a future service start as pre-booking", () => {
    expect(contractCandidateToClientPrefill(
      { ...baseCandidate, startDate: "2026-08-21" },
      new Date("2026-08-20T12:00:00+09:00"),
    ).serviceStatus).toBe("pre_booking");
  });
});
