import { extractVariables, getUnresolvedKeys, renderTemplate } from "./utils";

describe("shared template utilities", () => {
  it("prefers non-empty provided values over variable fallbacks", () => {
    const variables = [
      { key: "name", type: "text", label: "이름", required: true, fallback: "고객님" },
      { key: "count", type: "number", label: "횟수", required: false, fallback: "0" },
    ] as const;

    expect(renderTemplate("{{name}} / {{count}} / {{missing}}", {
      name: "  ",
      count: 3,
    }, variables)).toBe("고객님 / 3 / {{missing}}");
  });

  it("keeps unmatched placeholders and reports unresolved keys", () => {
    const rendered = renderTemplate("안녕하세요 {{name}} {{missing}}", { name: null });

    expect(rendered).toBe("안녕하세요 {{name}} {{missing}}");
    expect(getUnresolvedKeys(rendered)).toEqual(["name", "missing"]);
    expect(getUnresolvedKeys("{{name}} {{phone}}", { name: "지호" }, [
      { key: "phone", type: "phone", label: "전화번호", required: false, fallback: "010-0000-0000" },
    ])).toEqual([]);
    expect(extractVariables("{{name}} {{name}} {{other}}"))
      .toEqual(["name", "other"]);
  });

  it("renders numeric and boolean values without treating zero as empty", () => {
    expect(renderTemplate("{{zero}}/{{false}}", { zero: 0, false: false })).toBe("0/false");
  });

  it("does not resolve inherited values from the template data prototype", () => {
    const data = Object.create({ name: "프로토타입 고객" }) as Record<string, unknown>;

    expect(renderTemplate("{{name}}", data)).toBe("{{name}}");
    expect(renderTemplate("{{name}}", data, [
      { key: "name", type: "text", label: "이름", required: true, fallback: "고객님" },
    ])).toBe("고객님");
    expect(getUnresolvedKeys("{{name}}", data)).toEqual(["name"]);
  });
});
