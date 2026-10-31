import { readFileSync } from "node:fs";
import { join } from "node:path";

import { QueryClient, type QueryKey } from "@tanstack/react-query";

import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import { clientQueryKeys } from "@/hooks/useClients";
import { dashboardQueryKeys } from "@/hooks/useDashboardAnalytics";
import { eformsignQueryKeys } from "@/hooks/useEformsignDocuments";
import { employeeQueryKeys } from "@/hooks/useEmployees";
import { serviceRecordQueryKeys } from "@/hooks/useServiceRecords";
import { callInboxKeys } from "@/hooks/useCallInbox";
import { consultationInquiryQueryKeys } from "@/hooks/use-consultation-inquiries";
import { documentCategoryQueryKeys } from "@/hooks/use-document-categories";
import { documentQueryKeys } from "@/hooks/use-documents";
import { templateQueryKeys } from "@/hooks/use-message-templates";
import { NOTIFICATION_KEYS } from "@/hooks/usePushNotification";
import { holidayYearQueryKey } from "@/hooks/useBusinessDayCalendar";
import { voucherQueryKeys } from "@/hooks/useVoucherData";
import { messageTemplateKeys } from "@/features/message-templates/hooks/keys";
import { systemTemplateKeys } from "@/features/system-templates/hooks/useSystemTemplates";
import { settingsQueryKey as holidaySettingsQueryKey } from "@/components/app/holidays/HolidaySettingsSection";
import { QUERY_KEY as clientRegistrationPolicyKey } from "@/components/app/mobile-redesign/settings/use-client-registration-policy";
import { holidayReviewKeys } from "@/services/holiday-review";

import {
  ENTITY_QUERY_ROOTS,
  REALTIME_ENTITY_KINDS,
  allEntityQueryRoots,
  parseEntityChangedKinds,
  queryRootsForKinds,
} from "../entity-query-keys";

describe("ENTITY_QUERY_ROOTS", () => {
  it("covers exactly the kinds of the wire contract", () => {
    expect([...REALTIME_ENTITY_KINDS].sort()).toEqual(
      [
        "call", "client", "document", "employee", "file", "holiday",
        "inquiry", "message", "notification", "service-record", "settings",
      ],
    );
    expect(Object.keys(ENTITY_QUERY_ROOTS).sort()).toEqual([...REALTIME_ENTITY_KINDS].sort());
  });

  it("maps each kind to the roots the app's key factories actually use", () => {
    expect(ENTITY_QUERY_ROOTS.client).toEqual([clientQueryKeys.all, dashboardQueryKeys.analytics().slice(0, 1)]);
    expect(ENTITY_QUERY_ROOTS.employee).toEqual([employeeQueryKeys.all]);
    expect(ENTITY_QUERY_ROOTS.document).toEqual([
      eformsignQueryKeys.documents(),
      ["eformsign-docs"],
      ["eformsign-doc-client-names"],
      ["eformsign-document-detail"],
      ["eformsign-document-details"],
      dashboardQueryKeys.analytics().slice(0, 1),
    ]);
    expect(ENTITY_QUERY_ROOTS.message).toEqual([
      messageTriggerKeys.all,
      ["messages"],
      templateQueryKeys.all,
    ]);
    expect(templateQueryKeys.all).toEqual(messageTemplateKeys.all);
    expect(ENTITY_QUERY_ROOTS["service-record"]).toEqual([serviceRecordQueryKeys.all]);
    expect(ENTITY_QUERY_ROOTS.inquiry).toEqual([consultationInquiryQueryKeys.all]);
    expect(ENTITY_QUERY_ROOTS.call).toEqual([callInboxKeys.all]);
    expect(ENTITY_QUERY_ROOTS.file).toEqual([documentQueryKeys.all, documentCategoryQueryKeys.all]);
    expect(ENTITY_QUERY_ROOTS.holiday).toEqual([
      holidayYearQueryKey("b", 1).slice(0, 1),
      holidaySettingsQueryKey("b").slice(0, 1),
      holidayReviewKeys.events("b").slice(0, 1),
      holidayReviewKeys.itemsAll("b").slice(0, 1),
    ]);
    expect(ENTITY_QUERY_ROOTS.settings).toEqual([
      ["settings"],
      voucherQueryKeys.voucherPriceInfosRoot,
      voucherQueryKeys.areaTemplates,
      voucherQueryKeys.bankAccountInfos,
      voucherQueryKeys.voucherYears,
      voucherQueryKeys.outOfPocketPriceInfos,
      systemTemplateKeys.all,
    ]);
    expect(ENTITY_QUERY_ROOTS.notification).toEqual([NOTIFICATION_KEYS.all]);
  });
});

// What the real screens cache under: a key is "reached" when invalidating one
// of the kind's roots would match it, using the query cache's own prefix rule.
function kindReaches(kind: keyof typeof ENTITY_QUERY_ROOTS, key: QueryKey): boolean {
  const client = new QueryClient();
  client.setQueryData(key, "cached");
  return ENTITY_QUERY_ROOTS[kind].some(
    (root) => client.getQueryCache().findAll({ queryKey: root }).length > 0,
  );
}

describe("kinds reach the keys the screens really use", () => {
  it.each<[string, Parameters<typeof kindReaches>[0], QueryKey]>([
    ["inquiry: consultation inquiry list", "inquiry", consultationInquiryQueryKeys.list({ page: 1 })],
    ["call: call-inbox records", "call", callInboxKeys.records("all", "")],
    ["call: call-inbox drafts", "call", callInboxKeys.drafts("pending")],
    ["call: call-inbox count", "call", callInboxKeys.count()],
    ["file: document list", "file", documentQueryKeys.list({ categoryId: "c1" })],
    ["file: document detail", "file", documentQueryKeys.detail("d1")],
    ["file: document categories", "file", documentCategoryQueryKeys.all],
    ["holiday: calendar year", "holiday", holidayYearQueryKey("b1", 2026)],
    ["holiday: settings year", "holiday", holidaySettingsQueryKey("b1", 2026)],
    ["holiday: review events", "holiday", holidayReviewKeys.events("b1")],
    ["holiday: review items", "holiday", holidayReviewKeys.items("b1", "e1", {} as never)],
    ["message: template list", "message", templateQueryKeys.lists()],
    ["message: template detail", "message", templateQueryKeys.detail("t1")],
    ["message: feature template list", "message", messageTemplateKeys.list(1, 20)],
    ["settings: bank account infos", "settings", voucherQueryKeys.bankAccountInfos],
    ["settings: voucher price infos", "settings", voucherQueryKeys.voucherPriceInfos("t", 2026)],
    ["settings: all voucher price infos", "settings", voucherQueryKeys.allVoucherPriceInfos(2026)],
    ["settings: voucher years", "settings", voucherQueryKeys.voucherYears],
    ["settings: out-of-pocket price infos", "settings", voucherQueryKeys.outOfPocketPriceInfos],
    ["settings: area templates", "settings", voucherQueryKeys.areaTemplates],
    ["settings: system templates list", "settings", systemTemplateKeys.list()],
    ["settings: system template branch detail", "settings", systemTemplateKeys.branchDetail("b1", "k")],
    ["settings: client registration policy", "settings", clientRegistrationPolicyKey],
    ["settings: message sender approval (inline key shape)", "settings", ["settings", "message-sender-approval"]],
    ["notification: list", "notification", NOTIFICATION_KEYS.list("u1")],
    ["notification: unread count", "notification", NOTIFICATION_KEYS.unreadCount("u1")],
  ])("%s", (_name, kind, key) => {
    expect(kindReaches(kind, key)).toBe(true);
  });

  it("does not reach another kind's keys", () => {
    expect(kindReaches("inquiry", callInboxKeys.count())).toBe(false);
    expect(kindReaches("call", consultationInquiryQueryKeys.lists())).toBe(false);
    expect(kindReaches("notification", documentQueryKeys.all)).toBe(false);
    expect(kindReaches("file", templateQueryKeys.all)).toBe(false);
  });

  it("document reaches the contracts page's inline missing-customer-name key", () => {
    // The key is an inline literal in the page, not a factory, so pin the page's
    // actual shape: if the page renames it, this fails instead of going stale.
    const page = readFileSync(join(process.cwd(), "src/app/(shell)/contracts/page.tsx"), "utf8");
    const inline = /queryKey:\s*\[("eformsign-document-details"),\s*"missing-customer-names"/.exec(page);
    expect(inline).not.toBeNull();

    expect(kindReaches("document", ["eformsign-document-details", "missing-customer-names", ["id1"]])).toBe(true);
  });
});

describe("queryRootsForKinds", () => {
  it("returns the roots of one kind", () => {
    expect(queryRootsForKinds(["employee"])).toEqual([["employees"]]);
  });

  it("unions several kinds without repeating a shared root", () => {
    const roots = queryRootsForKinds(["client", "document"]);

    expect(roots.filter((root) => root[0] === "dashboard")).toHaveLength(1);
    expect(roots).toEqual(
      expect.arrayContaining([["clients"], ["eformsign-documents"], ["eformsign-docs"]]),
    );
  });

  it("allEntityQueryRoots is the de-duplicated union of every kind", () => {
    const all = allEntityQueryRoots();

    expect(new Set(all.map((root) => JSON.stringify(root))).size).toBe(all.length);
    const expected = new Set(Object.values(ENTITY_QUERY_ROOTS).flat().map((root) => JSON.stringify(root)));
    expect(new Set(all.map((root) => JSON.stringify(root)))).toEqual(expected);
    // Spot-check roots the new kinds add, so an emptied map cannot satisfy the derivation above.
    expect(all).toEqual(
      expect.arrayContaining([
        ["consultation-inquiries"],
        ["call-inbox"],
        ["documents"],
        ["document-categories"],
        ["holidays"],
        ["holiday-review-items"],
        ["settings"],
        ["voucher-price-infos"],
        ["notifications"],
        ["message-templates"],
        ["eformsign-document-details"],
      ]),
    );
  });
});

describe("parseEntityChangedKinds", () => {
  it("reads known kinds and drops unknown ones", () => {
    expect(parseEntityChangedKinds(JSON.stringify({ entities: ["client", "voucher", "message"] })))
      .toEqual(["client", "message"]);
  });

  it("de-duplicates repeated kinds", () => {
    expect(parseEntityChangedKinds(JSON.stringify({ entities: ["client", "client"] }))).toEqual(["client"]);
  });

  it.each([
    ["undefined", undefined],
    ["non-JSON text", "not json"],
    ["a payload without entities", JSON.stringify({ at: 1 })],
    ["a non-array entities", JSON.stringify({ entities: "client" })],
    ["null", "null"],
  ])("yields nothing for %s", (_name, data) => {
    expect(parseEntityChangedKinds(data)).toEqual([]);
  });
});
