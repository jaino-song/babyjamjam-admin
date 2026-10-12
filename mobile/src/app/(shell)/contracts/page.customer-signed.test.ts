import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

import { KR_BUILTIN_CALENDAR } from "@/lib/date/business-days";
import {
  getStatusCategory,
  isContractReviewWindowOpen,
  isProviderReviewWorkflowStep,
  isReviewerRejectedEformsignStatus,
  isRevokeRequestedEformsignStatus,
  isRevokedEformsignStatus,
  normalizeStatusCode,
} from "@/lib/eformsign/status-codes";
import type { EformsignDocument } from "@/lib/eformsign/types";
import {
  CONTRACT_DOC_DISPLAY_STATUS_LABELS,
  isContractDocDisplayStatus,
} from "@babyjamjam/shared/constants/eformsign-doc-status";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

// Run the page's real pure helpers (progressLabel / contractStageItems and
// everything they call) without loading its UI or network dependencies. Only
// the lucide icons are stubbed; no decision helper is mocked.
const HELPER_CONSTANTS = new Set([
  "CONTRACT_OPEN_CODES",
  "CONTRACT_OPEN_KEYWORDS",
  "CONTRACT_SEND_FAILURE_KEYWORDS",
  "CONTRACT_SEND_EVENT_KEYWORDS",
  "CONTRACT_EVENT_TYPE_KEYS",
  "CATEGORY_BY_DISPLAY_STATUS",
  "FILTER_LABELS",
  "FILTER_TO_STATUS_CATEGORY",
  "FILTER_TO_DISPLAY_STATUS",
  "FILTER_BY_CATEGORY",
  "SERVICE_RECORD_REVIEWER_REJECTED_LABEL",
]);
const parsedPage = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helperSource = parsedPage.statements
  .filter(
    (statement) =>
      (ts.isFunctionDeclaration(statement) && statement.name !== undefined && /^[a-z]/.test(statement.name.text)) ||
      (ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (declaration) => ts.isIdentifier(declaration.name) && HELPER_CONSTANTS.has(declaration.name.text),
        )),
  )
  .map((statement) => statement.getText(parsedPage))
  .join("\n");

type Category = "in-progress" | "signed" | "drafting" | "completed" | "revoke-requested" | "revoked" | "rejected-by-reviewer" | "expired" | "unknown";
interface StageItem {
  text: string;
}
interface StatusSignal {
  status_type: string | null;
  step_type: string | null;
  step_name: string | null;
  step_recipient_types: Array<string | null>;
  contract_end_date?: string | null;
  display_status?: string | null;
}
const helpers = vm.runInNewContext(
  ts.transpileModule(helperSource, {
    fileName: "helpers.tsx",
    compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText + "\n({ categorize, progressLabel, contractStageItems, countSignalsByFilter, detailHeaderStatusBadge, FILTER_LABELS, FILTER_TO_STATUS_CATEGORY, FILTER_TO_DISPLAY_STATUS, FILTER_BY_CATEGORY });",
  {
    getStatusCategory,
    isContractReviewWindowOpen,
    isProviderReviewWorkflowStep,
    isReviewerRejectedEformsignStatus,
    isRevokeRequestedEformsignStatus,
    isRevokedEformsignStatus,
    normalizeStatusCode,
    isContractDocDisplayStatus,
    CONTRACT_DOC_DISPLAY_STATUS_LABELS,
    KR_BUILTIN_CALENDAR,
    ...Object.fromEntries(
      ["FileText", "Send", "X", "Eye", "FileSignature", "CheckCircle2", "AlertTriangle"].map((name) => [name, name]),
    ),
  },
) as {
  categorize: (doc: EformsignDocument, calendar: typeof KR_BUILTIN_CALENDAR) => Category;
  progressLabel: (doc: EformsignDocument, calendar: typeof KR_BUILTIN_CALENDAR) => string;
  contractStageItems: (doc: EformsignDocument, category: Category, calendar: typeof KR_BUILTIN_CALENDAR) => StageItem[];
  countSignalsByFilter: (signals: StatusSignal[], calendar: typeof KR_BUILTIN_CALENDAR) => Record<string, number>;
  detailHeaderStatusBadge: (category: Category, isServiceRecord: boolean) => { label: string; tone: string };
  FILTER_LABELS: string[];
  FILTER_TO_STATUS_CATEGORY: Record<string, string | null>;
  FILTER_TO_DISPLAY_STATUS: Record<string, string>;
  FILTER_BY_CATEGORY: Record<Category, string | null>;
};

const SIGNED_PROGRESS = "4/6 - 이용자 서명 완료";
const SIGNED_STAGE = "이용자가 서명을 완료했습니다";

function makeDoc(overrides: {
  statusType: string;
  stepType: string;
  stepName: string;
  displayStatus?: string;
  histories?: unknown[];
  previousStatus?: unknown[];
}): EformsignDocument {
  return {
    id: "doc-1",
    document_number: "1",
    document_name: "계약서",
    template: { id: "contract-template", name: "계약서" },
    creator: { recipient_type: "member", name: "담당자" },
    last_editor: { recipient_type: "member", name: "담당자" },
    created_date: 0,
    updated_date: 0,
    display_status: overrides.displayStatus,
    current_status: {
      status_type: overrides.statusType,
      status_doc_type: "",
      status_doc_detail: "",
      step_type: overrides.stepType,
      step_index: "2",
      step_name: overrides.stepName,
      step_recipients: [],
      step_group: 0,
      expired_date: 0,
      _expired: false,
    },
    fields: [],
    next_status: [],
    previous_status: overrides.previousStatus ?? [],
    histories: overrides.histories ?? [],
    recipients: [],
    detail_template_info: [],
  } as unknown as EformsignDocument;
}

function view(doc: EformsignDocument) {
  const category = helpers.categorize(doc, KR_BUILTIN_CALENDAR);
  return {
    category,
    progress: helpers.progressLabel(doc, KR_BUILTIN_CALENDAR),
    stages: helpers.contractStageItems(doc, category, KR_BUILTIN_CALENDAR).map((item) => item.text),
  };
}

describe("mobile contracts: 'customer signed' follows the current state, not history keywords", () => {
  it("shows NOT signed when a rejected signature was re-requested and the doc is back on the customer step (060)", () => {
    const doc = makeDoc({
      statusType: "060",
      stepType: "05",
      stepName: "이용자",
      displayStatus: "pending",
      histories: [
        { status_type: "062", step_name: "이용자", executed_date: 1 },
        { status_type: "071", step_name: "제공기관 검토", executed_date: 2 },
        { status_type: "060", step_name: "이용자", executed_date: 3 },
      ],
      previousStatus: [{ status_type: "071", step_name: "제공기관 검토" }],
    });
    const { category, progress, stages } = view(doc);

    expect(category).toBe("drafting");
    expect(progress).not.toBe(SIGNED_PROGRESS);
    expect(stages).not.toContain(SIGNED_STAGE);
  });

  it("shows NOT signed for the same re-requested shape without a backend display_status (legacy path)", () => {
    const doc = makeDoc({
      statusType: "060",
      stepType: "05",
      stepName: "이용자",
      histories: [{ status_type: "062" }, { status_type: "071" }, { status_type: "060" }],
    });
    const { category, progress, stages } = view(doc);

    expect(category).toBe("drafting");
    expect(progress).not.toBe(SIGNED_PROGRESS);
    expect(stages).not.toContain(SIGNED_STAGE);
  });

  it("shows NOT signed when any history string merely contains the word 'signature' at 060", () => {
    const doc = makeDoc({
      statusType: "060",
      stepType: "05",
      stepName: "이용자",
      displayStatus: "pending",
      histories: [{ comment: "signature field was reset by the requester", action: "resend_signed_copy" }],
      previousStatus: [{ note: "서명 완료 안내 문자 발송" }],
    });
    const { progress, stages } = view(doc);

    expect(progress).not.toBe(SIGNED_PROGRESS);
    expect(stages).not.toContain(SIGNED_STAGE);
  });

  it("shows signed at the provider review step (070 / step 06)", () => {
    const doc = makeDoc({ statusType: "070", stepType: "06", stepName: "제공기관 검토", displayStatus: "review" });
    const { progress, stages } = view(doc);

    expect(progress).toBe("5/6 - 제공기관 검토 필요");
    expect(stages).toContain(SIGNED_STAGE);
  });

  it("shows signed when display_status is review even if the step payload is not the review step", () => {
    const doc = makeDoc({ statusType: "060", stepType: "05", stepName: "이용자", displayStatus: "review" });
    const { category, progress, stages } = view(doc);

    expect(category).toBe("in-progress");
    expect(progress).toBe(SIGNED_PROGRESS);
    expect(stages).toContain(SIGNED_STAGE);
  });

  it.each(["signed", "unassigned"])("shows signed for display_status %s (unassigned files under signed, like categorize)", (displayStatus) => {
    const doc = makeDoc({ statusType: "062", stepType: "05", stepName: "이용자", displayStatus });
    const { category, progress, stages } = view(doc);

    expect(category).toBe("signed");
    expect(progress).toBe(SIGNED_PROGRESS);
    expect(stages).toContain(SIGNED_STAGE);
  });

  it("shows signed on a completed contract", () => {
    const doc = makeDoc({ statusType: "100", stepType: "06", stepName: "제공기관 검토", displayStatus: "completed" });
    const { category, progress, stages } = view(doc);

    expect(category).toBe("completed");
    expect(progress).toBe("6/6 - 계약서 완료");
    expect(stages).toContain(SIGNED_STAGE);
  });

  it.each([
    ["with display_status revoke_requested", "revoke_requested"],
    ["without display_status (legacy payload)", undefined],
  ])("shows 040 (cancellation requested) as its own category, never expired or signed — %s", (_label, displayStatus) => {
    const doc = makeDoc({ statusType: "040", stepType: "06", stepName: "제공기관 검토", displayStatus });
    const { category, progress, stages } = view(doc);

    expect(category).toBe("revoke-requested");
    expect(progress).toBe("철회 요청됨");
    expect(stages).toContain("철회가 요청됐어요 — 아직 철회가 완료되지 않았어요");
    expect(stages).not.toContain(SIGNED_STAGE);
    expect(stages).not.toContain("문서 기간이 만료됐어요");
  });

  it.each([
    ["with display_status revoke_requested", "revoke_requested"],
    ["without display_status (legacy payload)", undefined],
  ])("shows 045 exactly like 040: its own revoke-requested category, never expired or signed — %s", (_label, displayStatus) => {
    const doc = makeDoc({ statusType: "045", stepType: "06", stepName: "제공기관 검토", displayStatus });
    const { category, progress, stages } = view(doc);

    expect(category).toBe("revoke-requested");
    expect(progress).toBe("철회 요청됨");
    expect(stages).toContain("철회가 요청됐어요 — 아직 철회가 완료되지 않았어요");
    expect(stages).not.toContain(SIGNED_STAGE);
    expect(stages).not.toContain("문서 기간이 만료됐어요");
  });

  it("reads 041 (a refused revoke) exactly like 060: customer not signed on the customer step", () => {
    const doc041 = makeDoc({ statusType: "041", stepType: "05", stepName: "이용자" });
    const doc060 = makeDoc({ statusType: "060", stepType: "05", stepName: "이용자" });

    expect(view(doc041)).toEqual(view(doc060));
    expect(view(doc041).category).toBe("drafting");
    expect(view(doc041).stages).not.toContain(SIGNED_STAGE);
  });

  it("reads 041 at the provider review step exactly like 060: customer signed, review needed", () => {
    const doc041 = makeDoc({ statusType: "041", stepType: "06", stepName: "제공기관 검토" });
    const doc060 = makeDoc({ statusType: "060", stepType: "06", stepName: "제공기관 검토" });

    expect(view(doc041)).toEqual(view(doc060));
    expect(view(doc041).progress).toBe("5/6 - 제공기관 검토 필요");
    expect(view(doc041).stages).toContain(SIGNED_STAGE);
  });

  it.each([
    ["042", "with display_status revoked", "revoked"],
    ["090", "with display_status revoked", "revoked"],
    ["042", "without display_status (legacy payload)", undefined],
    ["090", "without display_status (legacy payload)", undefined],
  ])("shows %s (revoked) as its own category, never expired or signed — %s", (statusType, _label, displayStatus) => {
    const doc = makeDoc({ statusType, stepType: "06", stepName: "제공기관 검토", displayStatus });
    const { category, progress, stages } = view(doc);

    expect(category).toBe("revoked");
    expect(progress).toBe("철회됨");
    expect(stages).toContain("문서가 철회됐어요");
    expect(stages).not.toContain(SIGNED_STAGE);
    expect(stages).not.toContain("문서 기간이 만료됐어요");
  });

  it("leaves 080 as expired and keeps 040 and 042/090 filed under the 기간 만료 filter pill", () => {
    const { category, progress } = view(makeDoc({ statusType: "080", stepType: "05", stepName: "이용자", displayStatus: "expired" }));
    expect(category).toBe("expired");
    expect(progress).toBe("기간 만료");
    expect(helpers.categorize(makeDoc({ statusType: "080", stepType: "05", stepName: "이용자" }), KR_BUILTIN_CALENDAR)).toBe("expired");
    // The tab/pill is unchanged: revoked files under 기간 만료 like revoke-requested.
    expect(/revoked: "기간 만료"/.test(source)).toBe(true);
    // 철회됨 takes the danger (burgundy) tone, not the muted 만료 one.
    expect(/case "revoked":\s*return \{\s*badge: "철회됨",\s*badgeTone: "burgundy"/.test(source)).toBe(true);
    // FILTER_BY_CATEGORY / categoryTones live beside the helpers in page.tsx; pin them in source.
    expect(/"revoke-requested": "기간 만료"/.test(source)).toBe(true);
    expect(/case "revoke-requested":\s*return \{\s*badge: "철회 요청됨",\s*badgeTone: "orange"/.test(source)).toBe(true);
  });

  it.each([
    ["with display_status", "rejected_by_reviewer"],
    ["without display_status (legacy payload)", undefined],
  ])("files 071 (반려됨, 계약-04) as its own category, not expired, not 검토 필요 — %s", (_label, displayStatus) => {
    for (const [stepType, stepName] of [
      ["06", "제공기관 검토"],
      ["05", "이용자"],
    ] as const) {
      const doc = makeDoc({ statusType: "071", stepType, stepName, displayStatus });
      const { category, progress, stages } = view(doc);

      expect(category).toBe("rejected-by-reviewer");
      expect(progress).toBe("반려됨 - 제공기관 재검토 대기");
      expect(progress).not.toBe("5/6 - 제공기관 검토 필요");
      // The customer's signature stays valid, and the rejection is stated.
      expect(stages).toContain(SIGNED_STAGE);
      expect(stages).toContain("제공기관 검토에서 반려됐어요 — 다시 검토가 요청되면 이어서 진행돼요");
      expect(stages).not.toContain("문서 기간이 만료됐어요");
    }
  });

  it("returns a document to a signed reading after a later 070, and completes it on 072", () => {
    expect(view(makeDoc({ statusType: "070", stepType: "06", stepName: "제공기관 검토", displayStatus: "signed" })).category).toBe("signed");
    expect(view(makeDoc({ statusType: "072", stepType: "06", stepName: "제공기관 검토", displayStatus: "completed" })).category).toBe("completed");
  });

  it("gives 반려됨 its own pill that the server displayStatus filter can select", () => {
    expect(helpers.FILTER_LABELS).toContain("반려됨");
    // Placed with the in-progress pills, before 계약 완료.
    expect(helpers.FILTER_LABELS.indexOf("반려됨")).toBe(helpers.FILTER_LABELS.indexOf("검토 필요") + 1);
    expect(helpers.FILTER_BY_CATEGORY["rejected-by-reviewer"]).toBe("반려됨");
    expect(helpers.FILTER_TO_DISPLAY_STATUS["반려됨"]).toBe("rejected_by_reviewer");
    expect(helpers.FILTER_TO_STATUS_CATEGORY["반려됨"]).toBeNull();
    // The pill label is the shared canonical one, not a hand-written copy.
    expect(CONTRACT_DOC_DISPLAY_STATUS_LABELS.rejected_by_reviewer).toBe("반려됨");
    expect(/badge: CONTRACT_DOC_DISPLAY_STATUS_LABELS\.rejected_by_reviewer/.test(source)).toBe(true);
    expect(/badge: "반려됨"/.test(source)).toBe(false);
    expect(/rejected_by_reviewer: "rejected-by-reviewer"/.test(source)).toBe(true);
  });

  const signalOf = (statusType: string, displayStatus?: string): StatusSignal => ({
    status_type: statusType,
    step_type: "06",
    step_name: "제공기관 검토",
    step_recipient_types: [],
    display_status: displayStatus,
  });

  it.each([
    ["with display_status", "rejected_by_reviewer"],
    ["without display_status (legacy payload)", undefined],
  ])("counts a 071 contract once, under 반려됨 only, and keeps it in 전체 — %s", (_label, displayStatus) => {
    const counts = helpers.countSignalsByFilter([signalOf("071", displayStatus)], KR_BUILTIN_CALENDAR);

    expect(counts["반려됨"]).toBe(1);
    expect(counts["전체"]).toBe(1);
    for (const label of helpers.FILTER_LABELS.filter((l) => l !== "전체" && l !== "반려됨")) {
      expect(counts[label]).toBe(0);
    }
  });

  it("leaves a 070 contract out of the 반려됨 pill", () => {
    const counts = helpers.countSignalsByFilter(
      [signalOf("070", "signed"), signalOf("071", "rejected_by_reviewer")],
      KR_BUILTIN_CALENDAR,
    );

    expect(counts["반려됨"]).toBe(1);
    expect(counts["서명 완료"]).toBe(1);
    expect(counts["전체"]).toBe(2);
  });

  it("shows the solid 반려됨 chip in the detail header of a contract at 071", () => {
    const badge = helpers.detailHeaderStatusBadge("rejected-by-reviewer", false);

    expect(badge).toEqual({ label: "반려됨", tone: "burgundy-solid" });
    // The solid tone exists in the closed badge union and has a CSS rule.
    const css = fs.readFileSync(
      path.join(process.cwd(), "src/components/app/mobile-redesign/redesign.css"),
      "utf8",
    );
    expect(/\.badge-mini\.burgundy-solid\s*\{[^}]*status-danger-solid-fg/.test(css)).toBe(true);
  });

  it("shows a 제공기록지 at 071 in the detail header exactly as its list row reads, never 반려됨", () => {
    const badge = helpers.detailHeaderStatusBadge("rejected-by-reviewer", true);

    expect(badge.label).toBe("거부·만료");
    expect(badge.label).not.toBe("반려됨");
    // Same tone the list row's Badge takes (tones.badgeTone).
    expect(badge.tone).toBe("burgundy");
    expect(/\? SERVICE_RECORD_REVIEWER_REJECTED_LABEL/.test(source)).toBe(true);
    // The header and the list row both read the same constant, and the header renders through the helper.
    expect(/detailHeaderStatusBadge\(category, isServiceRecord\),/.test(source)).toBe(true);
    expect(/tones\.badgeMini as BadgeTone/.test(source)).toBe(false);
  });

  it("leaves the detail header of other statuses unchanged", () => {
    expect(helpers.detailHeaderStatusBadge("signed", false)).toEqual({ label: "서명 완료", tone: "primary" });
    expect(helpers.detailHeaderStatusBadge("signed", true)).toEqual({ label: "서명 완료", tone: "primary" });
    expect(helpers.detailHeaderStatusBadge("revoked", false)).toEqual({ label: "철회됨", tone: "burgundy" });
  });

  it("no longer scans histories for signature keywords", () => {
    expect(/hasCustomerSignatureDocument|CONTRACT_SIGNATURE_KEYWORDS/.test(source)).toBe(false);
  });
});
