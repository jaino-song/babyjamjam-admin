import {
  renderServiceRecordLinks,
  SERVICE_RECORD_LINK_DEFAULT_TEMPLATE,
  type RenderServiceRecordLinksInput,
} from "./service-record-links";

const first = { activeRank: 1, url: "https://example.test/service-record/fixture-1" };
const second = { activeRank: 2, url: "https://example.test/service-record/fixture-2" };
const fifth = { activeRank: 5, url: "https://example.test/service-record/fixture-5" };
const variables = {
  employeeName: "테스트 제공인력",
  clientName: "테스트 산모",
  serviceStartDate: "2026년 12월 7일",
};
const legacyPlaceholder = "{{serviceRecordUrl}}";
const customTemplate = "{{employeeName}}님, 기록지: {{serviceRecordLinks}}";

function render(overrides: Partial<RenderServiceRecordLinksInput> = {}) {
  return renderServiceRecordLinks({
    template: SERVICE_RECORD_LINK_DEFAULT_TEMPLATE,
    variables,
    householdBabyCount: 1,
    members: [first],
    ...overrides,
  });
}

const approvedIntro = `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

테스트 제공인력 관리사님, 테스트 산모 산모님의 2026년 12월 7일 시작 서비스 제공기록지 작성 링크입니다.`;
const approvedBody = `매일 서비스 제공 완료 직전에 서비스 세부사항 기록 후에, 산모님께 승인을 받으시면 됩니다.

최초 접속 시에 관리사님의 전화번호 인증이 필요합니다. 링크 접속 후 휴대폰 번호로 본인확인하고, 방문일마다 기록을 남겨주세요.

감사합니다.

`;

describe("renderServiceRecordLinks", () => {
  it("keeps the approved single-baby message for a delegated provider", () => {
    expect(render()).toEqual({
      ok: true,
      content: `${approvedIntro}\n${approvedBody}제공기록지 링크\n${first.url}`,
      buttonUrl: first.url,
    });
  });

  it("produces the approved same-provider twin message without reordering its input", () => {
    const members = Object.freeze([Object.freeze(second), Object.freeze(first)]);

    expect(render({ householdBabyCount: 2, members })).toEqual({
      ok: true,
      content: `${approvedIntro}\n첫째와 둘째의 기록지를 각각 작성해 주세요.\n${approvedBody}` +
        `첫째 아기 제공기록지\n${first.url}\n\n둘째 아기 제공기록지\n${second.url}`,
      buttonUrl: null,
    });
    expect(members).toEqual([second, first]);
  });

  it("labels only the recipient's baby in a split twin household", () => {
    expect(render({ householdBabyCount: 2, members: [second] })).toEqual({
      ok: true,
      content: `${approvedIntro}\n둘째의 기록지를 작성해 주세요.\n${approvedBody}둘째 아기 제공기록지\n${second.url}`,
      buttonUrl: null,
    });
  });

  it("uses actual active ranks throughout the default message for partial membership", () => {
    expect(render({ householdBabyCount: 5, members: [fifth, first] })).toEqual({
      ok: true,
      content: `${approvedIntro}\n첫째와 다섯째의 기록지를 각각 작성해 주세요.\n${approvedBody}` +
        `첫째 아기 제공기록지\n${first.url}\n\n다섯째 아기 제공기록지\n${fifth.url}`,
      buttonUrl: null,
    });
  });

  it("lists three actual ranks and supports large positive household counts", () => {
    const last = { activeRank: 1000, url: "http://localhost:3000/service-record/fixture-last?view=a%20b#end" };

    expect(render({ template: customTemplate, householdBabyCount: 1000, members: [last, fifth, first] })).toEqual({
      ok: true,
      content: "테스트 제공인력님, 기록지: 첫째, 다섯째, 1000번째의 기록지를 각각 작성해 주세요.\n\n" +
        `첫째 아기 제공기록지\n${first.url}\n\n다섯째 아기 제공기록지\n${fifth.url}\n\n` +
        `1000번째 아기 제공기록지\n${last.url}`,
      buttonUrl: null,
    });
  });

  it("preserves the legacy singleton without count or rank", () => {
    expect(render({ householdBabyCount: null, members: [{ activeRank: null, url: first.url }] })).toEqual(render());
    expect(render({ template: "원문 {{serviceRecordUrl}} 안내", householdBabyCount: null,
      members: [{ activeRank: null, url: first.url }] })).toEqual({
      ok: true, content: `원문 ${first.url} 안내`, buttonUrl: first.url,
    });
  });

  it("keeps a known rank visible when count is unknown and withholds the quick button", () => {
    expect(render({ template: legacyPlaceholder, householdBabyCount: null, members: [second] })).toEqual({
      ok: true, content: `둘째의 기록지를 작성해 주세요.\n\n둘째 아기 제공기록지\n${second.url}`, buttonUrl: null,
    });
  });

  it("expands only the first plural placeholder and preserves surrounding custom text and variables", () => {
    const template = "{{ employeeName }} 전 {{serviceRecordUrl}} 중\n{{ serviceRecordLinks }} 후 {{serviceRecordLinks}} 끝\n";

    expect(render({
      template,
      variables: { ...variables, serviceRecordUrl: fifth.url, serviceRecordLinks: fifth.url },
      householdBabyCount: 2,
      members: [second, first],
    })).toEqual({
      ok: true,
      content: "테스트 제공인력 전  중\n첫째와 둘째의 기록지를 각각 작성해 주세요.\n\n" +
        `첫째 아기 제공기록지\n${first.url}\n\n둘째 아기 제공기록지\n${second.url} 후  끝\n`,
      buttonUrl: null,
    });
  });

  it.each([legacyPlaceholder, "{{serviceRecordLinks}}"])('expands the first %s for a custom ranked group', (placeholder) => {
    const template = `앞 ${placeholder} 중간 ${placeholder} 뒤`;

    expect(render({ template, householdBabyCount: 5, members: [fifth, first] })).toEqual({
      ok: true,
      content: "앞 첫째와 다섯째의 기록지를 각각 작성해 주세요.\n\n" +
        `첫째 아기 제공기록지\n${first.url}\n\n다섯째 아기 제공기록지\n${fifth.url} 중간  뒤`,
      buttonUrl: null,
    });
  });

  it("does not expand link placeholders supplied as ordinary variable values", () => {
    expect(render({ template: "{{custom}}", variables: { custom: legacyPlaceholder } })).toEqual({
      ok: false, reason: "missing_link_placeholder",
    });
    expect(render({ template: "원문 {{employeeName}}", householdBabyCount: 2, members: [first, second] })).toEqual({
      ok: false, reason: "missing_link_placeholder",
    });
  });

  const invalidTemplates: Array<[string, Partial<RenderServiceRecordLinksInput>]> = [
    ["a non-string template", { template: null as unknown as string }],
    ["null variables", { variables: null as unknown as RenderServiceRecordLinksInput["variables"] }],
    ["non-object variables", { variables: "fixture" as unknown as RenderServiceRecordLinksInput["variables"] }],
  ];

  it.each(invalidTemplates)("rejects %s as invalid_template", (_, overrides) => {
    expect(render(overrides)).toEqual({ ok: false, reason: "invalid_template" });
  });

  const invalidMembers: Array<[string, number | null, RenderServiceRecordLinksInput["members"]]> = [
    ["empty member list", 1, []],
    ["nonpositive count", 0, [first]],
    ["fractional count", 1.5, [first]],
    ["more members than babies", 1, [first, second]],
    ["unknown count for a group", null, [first, second]],
    ["unknown rank in a multi-baby family", 2, [{ ...first, activeRank: null }]],
    ["nonpositive rank", 2, [{ ...first, activeRank: 0 }]],
    ["fractional rank", 2, [{ ...first, activeRank: 1.5 }]],
    ["out-of-family rank", 2, [fifth]],
    ["duplicate rank", 2, [first, { ...second, activeRank: 1 }]],
    ["duplicate URL", 2, [first, { ...first, activeRank: 2 }]],
    ["equivalent URL", 2, [first, { ...second, url: first.url.replace("example.test", "EXAMPLE.test:443") }]],
    ["empty URL", 1, [{ ...first, url: "" }]],
    ["relative URL", 1, [{ ...first, url: "/service-record/fixture" }]],
    ["non-HTTP URL", 1, [{ ...first, url: "file:///service-record/fixture" }]],
    ["malformed HTTP URL", 1, [{ ...first, url: "https:///example.test/service-record/fixture" }]],
    ["URL with a username", 1, [{ ...first, url: first.url.replace("://", "://fixture@") }]],
    ["URL with a password only", 1, [{ ...first, url: first.url.replace("://", "://:fixture@") }]],
    ["URL with a malformed percent escape", 1, [{ ...first, url: `${first.url}%2G` }]],
    ["URL with a backslash", 1, [{ ...first, url: `${first.url}\\suffix` }]],
    ["URL with an angle bracket", 1, [{ ...first, url: `${first.url}<suffix` }]],
    ["URL with a double quote", 1, [{ ...first, url: `${first.url}"suffix` }]],
    ["URL with a backtick", 1, [{ ...first, url: `${first.url}\`suffix` }]],
    ["URL with an opening brace", 1, [{ ...first, url: `${first.url}{suffix` }]],
    ["URL with a closing brace", 1, [{ ...first, url: `${first.url}}suffix` }]],
    ["URL with a control character", 1, [{ ...first, url: `${first.url}\u0000suffix` }]],
    ["URL with a zero-width space", 1, [{ ...first, url: `${first.url}\u200Bsuffix` }]],
    ["multiple URLs in one member", 1, [{ ...first, url: `${first.url}\n${second.url}` }]],
  ];

  it.each(invalidMembers)("rejects %s for default and custom content", (_, householdBabyCount, members) => {
    const expected = { ok: false, reason: "invalid_members" };

    expect(render({ householdBabyCount, members })).toEqual(expected);
    expect(render({ template: customTemplate, householdBabyCount, members })).toEqual(expected);
  });

  const longUrl = `https://example.test/${"u".repeat(478)}z`;
  it.each([
    ["ASCII", "", 0, first.url],
    ["Korean/ASCII with long final URL", "산".repeat(700) + "a".repeat(100), 1500, longUrl],
    ["unrepresentable Unicode", "🙂☃" + "가".repeat(970), 1947, first.url],
  ])("preserves the complete URL at the carrier limit for %s", (_, start, startBytes, url) => {
    const prefix = start + "a".repeat(2000 - url.length - startBytes);
    const options = { variables: { prefix }, members: [{ activeRank: 1, url }] };
    const template = "{{prefix}}{{serviceRecordUrl}}";

    expect(render({ ...options, template })).toEqual({ ok: true, content: prefix + url, buttonUrl: url });
    expect(render({ ...options, template: `a${template}` })).toEqual({ ok: false, reason: "message_too_large" });
  });

  it("counts all default grouped instructions and URLs after ordinary substitutions", () => {
    const householdBabyCount = 2;
    const members = [first, { ...second, url: longUrl }];
    const result = render({ householdBabyCount, members });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Default twin example failed");
    // The approved body uses only ASCII and two-byte Korean carrier characters.
    const exampleBytes = result.content.length + (result.content.match(/[가-힣]/g)?.length ?? 0);
    const employeeName = variables.employeeName + "a".repeat(2000 - exampleBytes);

    expect(render({ householdBabyCount, members, variables: { ...variables, employeeName } })).toEqual({
      ok: true, content: result.content.replace(variables.employeeName, employeeName), buttonUrl: null,
    });
    expect(render({ householdBabyCount, members, variables: { ...variables, employeeName: employeeName + "a" } }))
      .toEqual({ ok: false, reason: "message_too_large" });
  });
});
