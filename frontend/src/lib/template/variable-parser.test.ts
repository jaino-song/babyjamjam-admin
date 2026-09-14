import type { MessageTemplateVariable } from "@babyjamjam/shared/types/message";
import { extractVariables, getUnresolvedKeys, renderTemplate } from "./variable-parser";

function makeVariable(key: string, fallback?: string): MessageTemplateVariable {
    return {
        key,
        type: "text",
        label: key,
        required: false,
        fallback,
    };
}

describe("renderTemplate", () => {
    it("uses the provided value when it is present (two-arg call, unchanged behavior)", () => {
        expect(renderTemplate("안녕 {{name}}", { name: "지호" })).toBe("안녕 지호");
    });

    it("leaves the placeholder untouched when no value is provided (two-arg call, unchanged behavior)", () => {
        expect(renderTemplate("안녕 {{name}}", {})).toBe("안녕 {{name}}");
    });

    it("retains the original placeholder when a value is blank", () => {
        expect(renderTemplate("안녕 {{ name }}", { name: "   " })).toBe("안녕 {{ name }}");
    });

    it("prefers a non-empty value over the variable's fallback", () => {
        const variables = [makeVariable("name", "고객님")];
        expect(renderTemplate("안녕 {{name}}", { name: "지호" }, variables)).toBe("안녕 지호");
    });

    it("uses the fallback when the value is missing", () => {
        const variables = [makeVariable("name", "고객님")];
        expect(renderTemplate("안녕 {{name}}", {}, variables)).toBe("안녕 고객님");
    });

    it("uses the fallback when the value is empty", () => {
        const variables = [makeVariable("name", "고객님")];
        expect(renderTemplate("안녕 {{name}}", { name: "" }, variables)).toBe("안녕 고객님");
    });

    it("leaves the placeholder untouched when there is no fallback for the key", () => {
        const variables = [makeVariable("other", "고객님")];
        expect(renderTemplate("안녕 {{name}}", {}, variables)).toBe("안녕 {{name}}");
    });

    it("leaves the placeholder untouched when the fallback is defined but empty", () => {
        const variables = [makeVariable("name", "   ")];
        expect(renderTemplate("안녕 {{name}}", {}, variables)).toBe("안녕 {{name}}");
    });

    it("renders numeric and boolean values, including zero and false", () => {
        expect(renderTemplate("{{zero}}/{{enabled}}", { zero: 0, enabled: false })).toBe("0/false");
    });

    it("applies the value, fallback, then original placeholder priority to duplicates", () => {
        const variables = [makeVariable("name", "고객님")];

        expect(renderTemplate("{{name}} / {{name}}", { name: "지호" }, variables)).toBe("지호 / 지호");
        expect(renderTemplate("{{name}} / {{name}}", {}, variables)).toBe("고객님 / 고객님");
        expect(renderTemplate("{{name}} / {{name}}", {}, [])).toBe("{{name}} / {{name}}");
    });

    it("does not resolve inherited values from the template data prototype", () => {
        const values = Object.create({ name: "프로토타입 고객" }) as Record<string, unknown>;

        expect(renderTemplate("{{name}}", values)).toBe("{{name}}");
        expect(renderTemplate("{{name}}", values, [makeVariable("name", "고객님")])).toBe("고객님");
    });

    it("extracts unique trimmed variable keys", () => {
        expect(extractVariables("{{ name }} {{name}} {{phone}} {{name}}"))
            .toEqual(["name", "phone"]);
    });
});

describe("getUnresolvedKeys", () => {
    it("returns keys that have neither a value nor a fallback", () => {
        expect(getUnresolvedKeys("{{name}} {{phone}}", { name: "지호" })).toEqual(["phone"]);
    });

    it("returns an empty array when a fallback resolves every remaining key", () => {
        const variables = [makeVariable("phone", "010-0000-0000")];
        expect(getUnresolvedKeys("{{name}} {{phone}}", { name: "지호" }, variables)).toEqual([]);
    });

    it("still reports keys whose fallback is missing or empty", () => {
        const variables = [makeVariable("phone", "")];
        expect(getUnresolvedKeys("{{name}} {{phone}}", { name: "지호" }, variables)).toEqual(["phone"]);
    });

    it("matches renderTemplate's two-arg behavior when no variables are passed", () => {
        expect(getUnresolvedKeys("{{name}} {{phone}}", { name: "지호" })).toEqual(["phone"]);
    });
});
