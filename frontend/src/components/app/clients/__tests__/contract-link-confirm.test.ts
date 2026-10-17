import type { EformsignLinkConfirmation } from "@/services/eformsign";

import {
    buildContractChoiceClientPatch,
    buildLinkConfirmRows,
    describeLinkConfirmDifferences,
    isLinkConfirmReady,
    type LinkConfirmChoices,
} from "../contract-link-confirm";

type Entry = Pick<EformsignLinkConfirmation, "document" | "client" | "differences">;

function entry(overrides: {
    differences: Entry["differences"];
    document?: Partial<Entry["document"]>;
    client?: Partial<Entry["client"]>;
}): Entry {
    return {
        differences: overrides.differences,
        document: { name: "박계약", phone: "01011112222", birthday: "1990-01-02", ...overrides.document },
        client: { id: 1, name: "김고객", phone: "01011112222", birthday: "1991-03-04", ...overrides.client },
    };
}

describe("buildLinkConfirmRows", () => {
    it("builds one row per differing item, name before birthday, whatever the order given", () => {
        const rows = buildLinkConfirmRows(entry({ differences: ["birthday", "name"] }));

        expect(rows.map((row) => row.field)).toEqual(["name", "birthday"]);
        expect(rows.map((row) => row.label)).toEqual(["이름", "생년월일"]);
    });

    it("builds only the differing item", () => {
        expect(buildLinkConfirmRows(entry({ differences: ["name"] })).map((row) => row.field)).toEqual(["name"]);
        expect(buildLinkConfirmRows(entry({ differences: ["birthday"] })).map((row) => row.field)).toEqual([
            "birthday",
        ]);
    });

    it("lists both sides as selectable when both hold a value", () => {
        const [row] = buildLinkConfirmRows(entry({ differences: ["name"] }));

        expect(row).toMatchObject({ contractValue: "박계약", clientValue: "김고객" });
        expect(row.selectableSides).toEqual(["contract", "client"]);
    });

    it.each([
        ["null", null],
        ["empty", ""],
        ["blank", "   "],
    ])("treats a %s contract value as missing and not selectable", (_label, missing) => {
        const [row] = buildLinkConfirmRows(entry({ differences: ["birthday"], document: { birthday: missing } }));

        expect(row.contractValue).toBeNull();
        expect(row.selectableSides).toEqual(["client"]);
    });

    it("treats a missing client value as not selectable", () => {
        const [row] = buildLinkConfirmRows(entry({ differences: ["birthday"], client: { birthday: null } }));

        expect(row.clientValue).toBeNull();
        expect(row.selectableSides).toEqual(["contract"]);
    });

    it("leaves nothing selectable when both sides are missing", () => {
        const [row] = buildLinkConfirmRows(
            entry({ differences: ["birthday"], document: { birthday: null }, client: { birthday: null } }),
        );

        expect(row.selectableSides).toEqual([]);
    });

    it("builds no rows when nothing differs", () => {
        expect(buildLinkConfirmRows(entry({ differences: [] }))).toEqual([]);
    });
});

describe("describeLinkConfirmDifferences", () => {
    it("names the differing items in words", () => {
        expect(describeLinkConfirmDifferences(["name"])).toBe("이름이 다릅니다");
        expect(describeLinkConfirmDifferences(["birthday"])).toBe("생년월일이 다릅니다");
        expect(describeLinkConfirmDifferences(["birthday", "name"])).toBe("이름과 생년월일이 다릅니다");
    });
});

describe("isLinkConfirmReady", () => {
    const both = buildLinkConfirmRows(entry({ differences: ["name", "birthday"] }));

    it("is not ready with no choices, nor with only some rows chosen", () => {
        expect(isLinkConfirmReady(both, {})).toBe(false);
        expect(isLinkConfirmReady(both, { name: "contract" })).toBe(false);
        expect(isLinkConfirmReady(both, { birthday: "client" })).toBe(false);
    });

    it.each<[string, LinkConfirmChoices]>([
        ["contract and contract", { name: "contract", birthday: "contract" }],
        ["contract and client", { name: "contract", birthday: "client" }],
        ["client and contract", { name: "client", birthday: "contract" }],
        ["client and client", { name: "client", birthday: "client" }],
    ])("is ready once every row has a choice (%s)", (_label, choices) => {
        expect(isLinkConfirmReady(both, choices)).toBe(true);
    });

    it("does not count a choice of a side that has no value", () => {
        const rows = buildLinkConfirmRows(entry({ differences: ["name"], document: { name: null } }));

        expect(isLinkConfirmReady(rows, { name: "contract" })).toBe(false);
        expect(isLinkConfirmReady(rows, { name: "client" })).toBe(true);
    });

    it("needs no choice for a row with nothing selectable, but still for the other row", () => {
        const rows = buildLinkConfirmRows(
            entry({
                differences: ["name", "birthday"],
                document: { birthday: null },
                client: { birthday: null },
            }),
        );

        expect(isLinkConfirmReady(rows, {})).toBe(false);
        expect(isLinkConfirmReady(rows, { name: "client" })).toBe(true);
    });

    it("is ready without any choice when every row has nothing selectable", () => {
        const rows = buildLinkConfirmRows(
            entry({ differences: ["birthday"], document: { birthday: null }, client: { birthday: null } }),
        );

        expect(isLinkConfirmReady(rows, {})).toBe(true);
    });

    it("is never ready with no rows at all", () => {
        expect(isLinkConfirmReady([], {})).toBe(false);
    });
});

describe("buildContractChoiceClientPatch", () => {
    const both = buildLinkConfirmRows(entry({ differences: ["name", "birthday"] }));

    it("holds both fields when the contract's values were chosen for both", () => {
        expect(buildContractChoiceClientPatch(both, { name: "contract", birthday: "contract" })).toEqual({
            name: "박계약",
            birthday: "1990-01-02",
        });
    });

    it("holds only the field whose contract value was chosen", () => {
        expect(buildContractChoiceClientPatch(both, { name: "contract", birthday: "client" })).toEqual({
            name: "박계약",
        });
        expect(buildContractChoiceClientPatch(both, { name: "client", birthday: "contract" })).toEqual({
            birthday: "1990-01-02",
        });
    });

    it("is empty when the client's values were chosen", () => {
        expect(buildContractChoiceClientPatch(both, { name: "client", birthday: "client" })).toEqual({});
    });

    it("is empty when nothing was chosen", () => {
        expect(buildContractChoiceClientPatch(both, {})).toEqual({});
    });

    it("ignores a choice of the contract side when the contract has no value", () => {
        const rows = buildLinkConfirmRows(entry({ differences: ["birthday"], document: { birthday: null } }));

        expect(buildContractChoiceClientPatch(rows, { birthday: "contract" })).toEqual({});
    });

    it("ignores a choice for an item that does not differ", () => {
        const rows = buildLinkConfirmRows(entry({ differences: ["name"] }));

        expect(buildContractChoiceClientPatch(rows, { name: "client", birthday: "contract" })).toEqual({});
    });
});
