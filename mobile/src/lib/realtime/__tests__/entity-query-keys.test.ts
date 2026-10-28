import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import { clientQueryKeys } from "@/hooks/useClients";
import { dashboardQueryKeys } from "@/hooks/useDashboardAnalytics";
import { eformsignQueryKeys } from "@/hooks/useEformsignDocuments";
import { employeeQueryKeys } from "@/hooks/useEmployees";
import { serviceRecordQueryKeys } from "@/hooks/useServiceRecords";

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
      ["client", "document", "employee", "message", "service-record"],
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
      dashboardQueryKeys.analytics().slice(0, 1),
    ]);
    expect(ENTITY_QUERY_ROOTS.message).toEqual([messageTriggerKeys.all, ["messages"]]);
    expect(ENTITY_QUERY_ROOTS["service-record"]).toEqual([serviceRecordQueryKeys.all]);
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
    expect(all.map((root) => root[0]).sort()).toEqual([
      "clients",
      "dashboard",
      "eformsign-doc-client-names",
      "eformsign-docs",
      "eformsign-document-detail",
      "eformsign-documents",
      "employees",
      "message-triggers",
      "messages",
      "service-records",
    ]);
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
