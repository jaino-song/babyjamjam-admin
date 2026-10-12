import { compareEformsignClientIdentity } from "application/utils/eformsign-client-identity";

describe("compareEformsignClientIdentity", () => {
    const now = new Date("2026-07-21T00:00:00.000Z");
    const contract = { name: "김민지", birthday: "1990-05-01" };

    it.each([
        ["equal", contract, []],
        ["different name", { ...contract, name: "박민지" }, ["name"]],
        ["whitespace", { ...contract, name: " 김 \t민\n지 " }, []],
        ["NFD Hangul", { ...contract, name: contract.name.normalize("NFD") }, []],
        ["different birthday", { ...contract, birthday: "1990-05-02" }, ["birthday"]],
        ["both differ", { name: "박민지", birthday: "1990-05-02" }, ["name", "birthday"]],
        ["legacy birthday", { ...contract, birthday: "900501" }, []],
        ["dotted birthday", { ...contract, birthday: "1990.05.01" }, []],
    ])("compares %s", (_label, client, expected) => {
        expect(compareEformsignClientIdentity(contract, client, now)).toEqual(expected);
    });

    it.each(["", " \t\n", null, undefined])("rejects missing name %s on either side", (name) => {
        const incomplete = { ...contract, name };
        expect(compareEformsignClientIdentity(contract, incomplete, now)).toEqual(["name"]);
        expect(compareEformsignClientIdentity(incomplete, contract, now)).toEqual(["name"]);
        expect(compareEformsignClientIdentity(incomplete, incomplete, now)).toEqual(["name"]);
    });

    it.each([null, undefined, "", "not-a-date", "1990-02-30"])("rejects birthday %s on either side", (birthday) => {
        const incomplete = { ...contract, birthday };
        expect(compareEformsignClientIdentity(contract, incomplete, now)).toEqual(["birthday"]);
        expect(compareEformsignClientIdentity(incomplete, contract, now)).toEqual(["birthday"]);
        expect(compareEformsignClientIdentity(incomplete, incomplete, now)).toEqual(["birthday"]);
    });

    it("keeps names case-sensitive", () => {
        expect(compareEformsignClientIdentity(
            { ...contract, name: "Minji" }, { ...contract, name: "minji" }, now,
        )).toEqual(["name"]);
    });

    it("uses the same supplied century boundary for both birthdays", () => {
        expect(compareEformsignClientIdentity(
            { ...contract, birthday: "270101" }, { ...contract, birthday: "1927-01-01" }, now,
        )).toEqual([]);
    });
});
