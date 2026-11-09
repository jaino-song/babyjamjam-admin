import { dateDirectionParticle } from "../service-record-period-mismatch";

it.each([
    [0, "으로"], [1, "로"], [2, "로"], [3, "으로"], [4, "로"],
    [5, "로"], [6, "으로"], [7, "로"], [8, "로"], [9, "로"],
])("uses the Korean direction particle for last digit %s", (digit, expected) => {
    expect(dateDirectionParticle(`2026.08.1${digit}`)).toBe(expected);
});
