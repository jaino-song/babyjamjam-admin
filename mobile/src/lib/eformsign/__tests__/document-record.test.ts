import { buildInitialSignRequestDocRecord } from "../document-record";

describe("buildInitialSignRequestDocRecord", () => {
  it("builds the canonical initial sign-request status payload", () => {
    expect(buildInitialSignRequestDocRecord({
      documentId: "doc-1",
      clientId: 7,
      stepRecipientName: "김고객",
      stepRecipientSms: "010-1234-5678",
      expiredDate: "2026-06-30T00:00:00.000Z",
      linkToClient: true,
    })).toEqual({
      documentId: "doc-1",
      clientId: 7,
      statusType: "060",
      statusDetail: "서명 요청됨",
      stepType: "01",
      stepIndex: "1",
      stepName: "서명 요청",
      stepRecipientType: "01",
      stepRecipientName: "김고객",
      stepRecipientSms: "010-1234-5678",
      expiredDate: "2026-06-30T00:00:00.000Z",
      linkToClient: true,
    });
  });
});
