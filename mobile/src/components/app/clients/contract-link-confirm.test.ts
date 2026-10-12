import { buildContractLinkUpdate, canConfirmContractLink, contractLinkRows } from "./contract-link-confirm";
import type { EformsignLinkConfirmation } from "@/services/api";

const confirmation: EformsignLinkConfirmation = {
  documentId: "doc-1", documentName: "계약서 A", statusType: "020", statusDetail: "", createdDate: "2026-10-13T00:00:00Z",
  document: { name: "계약 이름", phone: "01012345678", birthday: "1990-01-01" },
  client: { id: 7, name: "고객 이름", phone: "01012345678", birthday: "1991-02-02" },
  differences: ["name", "birthday"], canConfirm: true,
};

describe("contract link choices", () => {
  for (const differences of [["name"], ["birthday"], ["name", "birthday"]] as const) {
    for (const documentMissing of [false, true]) {
      for (const clientMissing of [false, true]) {
        it(`${differences.join("+")} document missing ${documentMissing}, client missing ${clientMissing}`, () => {
          const entry = { ...confirmation, differences: [...differences],
            document: { ...confirmation.document, name: documentMissing ? null : "A", birthday: documentMissing ? null : "1990-01-01" },
            client: { ...confirmation.client, name: clientMissing ? "" : "B", birthday: clientMissing ? null : "1991-02-02" },
          };
          const rows = contractLinkRows(entry);
          expect(rows.map(row => row.needsChoice)).toEqual(differences.map(() => !(documentMissing && clientMissing)));
          expect(canConfirmContractLink(entry, {})).toBe(documentMissing && clientMissing);
          const documentChoices = Object.fromEntries(differences.map(field => [field, "document"]));
          const clientChoices = Object.fromEntries(differences.map(field => [field, "client"]));
          expect(canConfirmContractLink(entry, documentChoices)).toBe(!documentMissing || clientMissing);
          expect(canConfirmContractLink(entry, clientChoices)).toBe(!clientMissing || documentMissing);
          expect(buildContractLinkUpdate(entry, clientChoices)).toEqual({});
          expect(buildContractLinkUpdate(entry, documentChoices)).toEqual(documentMissing ? {} : Object.fromEntries(differences.map(field => [field, entry.document[field]])));
        });
      }
    }
  }
  it("requires every differing item and only updates contract-chosen fields", () => {
    expect(canConfirmContractLink(confirmation, { name: "document" })).toBe(false);
    expect(canConfirmContractLink(confirmation, { name: "document", birthday: "client" })).toBe(true);
    expect(buildContractLinkUpdate(confirmation, { name: "document", birthday: "client" })).toEqual({ name: "계약 이름" });
    expect(canConfirmContractLink({ ...confirmation, canConfirm: false }, { name: "document", birthday: "client" })).toBe(false);
  });
  it("covers independently missing values and choices across both fields", () => {
    for (const documentName of [null, "A"]) {
      for (const clientName of ["", "B"]) {
        for (const documentBirthday of [null, "1990-01-01"]) {
          for (const clientBirthday of [null, "1991-02-02"]) {
            const entry = { ...confirmation,
              document: { ...confirmation.document, name: documentName, birthday: documentBirthday },
              client: { ...confirmation.client, name: clientName, birthday: clientBirthday },
            };
            expect(contractLinkRows(entry).map(row => row.needsChoice)).toEqual([
              Boolean(documentName || clientName), Boolean(documentBirthday || clientBirthday),
            ]);
            for (const name of [undefined, "document", "client"]) {
              for (const birthday of [undefined, "document", "client"]) {
                const choices = { name, birthday };
                const nameComplete = !(documentName || clientName) || Boolean(name === "document" ? documentName : name === "client" ? clientName : null);
                const birthdayComplete = !(documentBirthday || clientBirthday) || Boolean(birthday === "document" ? documentBirthday : birthday === "client" ? clientBirthday : null);
                expect(canConfirmContractLink(entry, choices)).toBe(nameComplete && birthdayComplete);
                expect(buildContractLinkUpdate(entry, choices)).toEqual({
                  ...(name === "document" && documentName ? { name: documentName } : {}),
                  ...(birthday === "document" && documentBirthday ? { birthday: documentBirthday } : {}),
                });
              }
            }
          }
        }
      }
    }
  });
});
