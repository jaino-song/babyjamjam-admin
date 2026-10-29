import { QueryClient, type QueryKey } from "@tanstack/react-query";

import { settingsQueryKey as holidaySettingsQueryKey } from "@/components/app/holidays/HolidaySettingsSection";
import { clientKeys } from "@/features/clients/hooks/keys";
import { messageTemplateKeys } from "@/features/message-templates/hooks/keys";
import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import { serviceRecordKeys } from "@/features/service-records/hooks/keys";
import { systemTemplateKeys } from "@/features/system-templates/hooks/useSystemTemplates";
import { consultationInquiryQueryKeys } from "@/hooks/useConsultationInquiries";
import { dashboardQueryKeys } from "@/hooks/useDashboardStats";
import { holidayYearQueryKey } from "@/hooks/useBusinessDayCalendar";
import { documentCategoryQueryKeys } from "@/hooks/use-document-categories";
import { documentQueryKeys } from "@/hooks/use-documents";
import { templateQueryKeys } from "@/hooks/use-message-templates";
import { clientQueryKeys } from "@/hooks/useClients";
import { employeeQueryKeys } from "@/hooks/useEmployees";
import { eformsignDocumentJobsQueryKeys } from "@/hooks/useEformsignDocumentJobs";
import { eformsignQueryKeys } from "@/hooks/useEformsignDocuments";
import { NOTIFICATION_KEYS } from "@/hooks/usePushNotification";
import { voucherQueryKeys } from "@/hooks/useVoucherData";
import { holidayReviewKeys } from "@/services/holiday-review";

import {
    allQueryKeyRoots,
    ENTITY_QUERY_KEY_ROOTS,
    queryKeyRootsForKinds,
    type RealtimeEntityKind,
} from "../entity-query-keys";

// Real TanStack prefix semantics: seed the key, invalidate by the root, and see
// whether the query was reached. Avoids re-implementing the matcher here.
const isReachedBy = (root: QueryKey, key: QueryKey): boolean => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(key, "cached");
    return queryClient.getQueryCache().findAll({ queryKey: root }).length === 1;
};

const reachesKey = (roots: readonly QueryKey[], key: QueryKey) =>
    roots.some((root) => isReachedBy(root, key));

// The screen's real query key per kind, built from its factory with sample
// arguments. Keys with no factory in the app (inline literals) are marked so.
const REAL_KEYS: Record<RealtimeEntityKind, Array<[label: string, key: QueryKey]>> = {
    client: [
        ["clientKeys.all", clientKeys.all],
        ["clientKeys.lists", clientKeys.lists()],
        ["clientQueryKeys.detail", clientQueryKeys.detail(1)],
        ["dashboardQueryKeys.stats", dashboardQueryKeys.stats()],
    ],
    employee: [
        ["employeeQueryKeys.detail", employeeQueryKeys.detail(1)],
        ["employeeQueryKeys.list", employeeQueryKeys.list({ page: 1 })],
        ["dynamic-select data source (inline literal)", ["data-source", "employees"]],
    ],
    document: [
        ["eformsignQueryKeys.documentsByType", eformsignQueryKeys.documentsByType("completed")],
        ["eformsignQueryKeys.clientCandidate", eformsignQueryKeys.clientCandidate("doc-1")],
        ["eformsignDocumentJobsQueryKeys.list", eformsignDocumentJobsQueryKeys.list("branch-1")],
        ["dashboardQueryKeys.overview", dashboardQueryKeys.overview(10)],
        // No factory builds these three today; kept from the original map.
        ["eformsign-docs (no factory)", ["eformsign-docs", "branch-1"]],
        ["eformsign-client-names (no factory)", ["eformsign-client-names"]],
        ["eformsign-status-counts (no factory)", ["eformsign-status-counts", "branch-1"]],
    ],
    message: [
        ["messageTriggerKeys.upcoming", messageTriggerKeys.upcoming()],
        ["messageTemplateKeys.list", messageTemplateKeys.list(1, 10)],
        ["templateQueryKeys.detail", templateQueryKeys.detail("template-1")],
        ["dynamic-select data source (inline literal)", ["data-source", "message-variables"]],
    ],
    "service-record": [
        ["serviceRecordKeys.clientOverview", serviceRecordKeys.clientOverview(1)],
        ["serviceRecordKeys.revisionHistory", serviceRecordKeys.revisionHistory(1)],
        ["serviceRecordKeys.revisionChanges", serviceRecordKeys.revisionChanges(1, "rev-1")],
        ["serviceRecordKeys.caregiverEditChanges", serviceRecordKeys.caregiverEditChanges(1, "edit-1")],
    ],
    inquiry: [
        ["consultationInquiryQueryKeys.list", consultationInquiryQueryKeys.list({ page: 1, limit: 20 })],
        ["consultationInquiryQueryKeys.allPages", consultationInquiryQueryKeys.allPages({ search: "kim" })],
    ],
    // Desktop has no call inbox, so there is no screen key to reach.
    call: [],
    file: [
        ["documentQueryKeys.list", documentQueryKeys.list({ categoryId: "c1" })],
        ["documentQueryKeys.capabilities", documentQueryKeys.capabilities()],
        ["documentCategoryQueryKeys.all", documentCategoryQueryKeys.all],
    ],
    holiday: [
        ["holidayYearQueryKey", holidayYearQueryKey("branch-1", 2026)],
        ["HolidaySettingsSection settingsQueryKey (year)", holidaySettingsQueryKey("branch-1", 2026)],
        ["holidayReviewKeys.events", holidayReviewKeys.events("branch-1")],
        ["holidayReviewKeys.items", holidayReviewKeys.items("branch-1", "event-1", {} as never)],
        ["dashboardQueryKeys.stats", dashboardQueryKeys.stats()],
    ],
    settings: [
        // Inline literals in the settings / clients / messages screens; no factory.
        ["settings notification preferences (no factory)", ["settings", "notification-preferences"]],
        ["settings message sender approval (no factory)", ["settings", "message-sender-approval"]],
        ["voucherQueryKeys.areaTemplates", voucherQueryKeys.areaTemplates],
        ["voucherQueryKeys.availableClientAreas", voucherQueryKeys.availableClientAreas],
        ["voucherQueryKeys.voucherPriceInfos", voucherQueryKeys.voucherPriceInfos("type", 2026)],
        ["voucherQueryKeys.allVoucherPriceInfos", voucherQueryKeys.allVoucherPriceInfos(2026)],
        ["voucherQueryKeys.outOfPocketPriceInfos", voucherQueryKeys.outOfPocketPriceInfos],
        ["voucherQueryKeys.voucherYears", voucherQueryKeys.voucherYears],
        ["voucherQueryKeys.bankAccountInfos", voucherQueryKeys.bankAccountInfos],
        ["dynamic-select data source (inline literal)", ["data-source", "areas"]],
        ["systemTemplateKeys.global.list", systemTemplateKeys.list()],
        ["systemTemplateKeys.branchList", systemTemplateKeys.branchList("branch-1")],
    ],
    notification: [
        ["NOTIFICATION_KEYS.list", NOTIFICATION_KEYS.list("user-1")],
        ["NOTIFICATION_KEYS.unreadCount", NOTIFICATION_KEYS.unreadCount("user-1")],
    ],
};

const KINDS = Object.keys(ENTITY_QUERY_KEY_ROOTS) as RealtimeEntityKind[];

describe("queryKeyRootsForKinds", () => {
    it("has a screen-key table row for every kind in the map", () => {
        expect(Object.keys(REAL_KEYS).sort()).toEqual([...KINDS].sort());
    });

    describe.each(
        KINDS.filter((kind) => REAL_KEYS[kind].length > 0).map((kind) => [kind, REAL_KEYS[kind]] as const),
    )("%s", (kind, screenKeys) => {
        it.each(screenKeys)("reaches the real screen key %s", (_label, key) => {
            expect(reachesKey(queryKeyRootsForKinds([kind]), key)).toBe(true);
        });

        it("has no root that none of the real screen keys falls under", () => {
            for (const root of queryKeyRootsForKinds([kind])) {
                expect(screenKeys.some(([, key]) => isReachedBy(root, key))).toBe(true);
            }
        });
    });

    it("maps call to nothing on desktop", () => {
        expect(queryKeyRootsForKinds(["call"])).toEqual([]);
    });

    it("does not reach another kind's screen key", () => {
        const employeeRoots = queryKeyRootsForKinds(["employee"]);
        const [, inquiryKey] = REAL_KEYS.inquiry[0];
        const [, notificationKey] = REAL_KEYS.notification[0];
        expect(reachesKey(employeeRoots, inquiryKey)).toBe(false);
        expect(reachesKey(employeeRoots, notificationKey)).toBe(false);
    });

    it("keeps the file library apart from the eformsign document kind", () => {
        const [, libraryKey] = REAL_KEYS.file[0];
        const [, eformsignKey] = REAL_KEYS.document[0];
        expect(reachesKey(queryKeyRootsForKinds(["document"]), libraryKey)).toBe(false);
        expect(reachesKey(queryKeyRootsForKinds(["file"]), eformsignKey)).toBe(false);
    });

    it("ignores unknown kinds and malformed entries", () => {
        expect(queryKeyRootsForKinds(["voucher", 7, null, "constructor", "__proto__"])).toEqual([]);
    });

    it("keeps the known kinds when mixed with unknown ones", () => {
        expect(queryKeyRootsForKinds(["voucher", "inquiry"])).toEqual(queryKeyRootsForKinds(["inquiry"]));
        expect(queryKeyRootsForKinds(["voucher", "inquiry"])).toEqual([consultationInquiryQueryKeys.all]);
    });

    it("de-duplicates a root shared by several kinds", () => {
        const roots = queryKeyRootsForKinds(["client", "document", "holiday"]);
        expect(roots.filter((root) => root[0] === "dashboard")).toHaveLength(1);

        const dataSources = queryKeyRootsForKinds(["employee", "message", "settings"]);
        expect(dataSources.filter((root) => root[0] === "data-source")).toHaveLength(1);
    });
});

describe("allQueryKeyRoots", () => {
    it("is the de-duplicated union of every root in the map", () => {
        const roots = allQueryKeyRoots().map((root) => root[0]);
        expect(new Set(roots).size).toBe(roots.length);

        const expected = new Set(
            KINDS.flatMap((kind) => ENTITY_QUERY_KEY_ROOTS[kind].map((root) => root[0])),
        );
        expect(new Set(roots)).toEqual(expected);
    });

    it("contains the roots every new kind added", () => {
        const roots = new Set(allQueryKeyRoots().map((root) => root[0]));
        for (const kind of ["inquiry", "file", "holiday", "settings", "notification"] as const) {
            for (const [, key] of REAL_KEYS[kind]) {
                expect(reachesKey(allQueryKeyRoots(), key)).toBe(true);
            }
        }
        for (const root of [
            "consultation-inquiries",
            "documents",
            "document-categories",
            "holidays",
            "holiday-settings",
            "holiday-review-events",
            "holiday-review-items",
            "settings",
            "area-templates",
            "voucher-price-infos",
            "all-voucher-price-infos",
            "out-of-pocket-price-infos",
            "voucher-years",
            "bank-account-infos",
            "data-source",
            "system-templates",
            "notifications",
            "message-templates",
            "eformsign-client-candidate",
        ]) {
            expect(roots.has(root)).toBe(true);
        }
    });
});
