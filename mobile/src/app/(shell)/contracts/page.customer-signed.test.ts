import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

import { KR_BUILTIN_CALENDAR } from "@/lib/date/business-days";
import {
  getStatusCategory,
  isContractReviewWindowOpen,
  isProviderReviewWorkflowStep,
  isRevokeRequestedEformsignStatus,
  normalizeStatusCode,
} from "@/lib/eformsign/status-codes";
import type { EformsignDocument } from "@/lib/eformsign/types";
import { isContractDocDisplayStatus } from "@babyjamjam/shared/constants/eformsign-doc-status";

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

type Category = "in-progress" | "signed" | "drafting" | "completed" | "revoke-requested" | "expired" | "unknown";
interface StageItem {
  text: string;
}
const helpers = vm.runInNewContext(
  ts.transpileModule(helperSource, {
    fileName: "helpers.tsx",
    compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText + "\n({ categorize, progressLabel, contractStageItems });",
  {
    getStatusCategory,
    isContractReviewWindowOpen,
    isProviderReviewWorkflowStep,
    isRevokeRequestedEformsignStatus,
    normalizeStatusCode,
    isContractDocDisplayStatus,
    KR_BUILTIN_CALENDAR,
    ...Object.fromEntries(
      ["FileText", "Send", "X", "Eye", "FileSignature", "CheckCircle2", "AlertTriangle"].map((name) => [name, name]),
    ),
  },
) as {
  categorize: (doc: EformsignDocument, calendar: typeof KR_BUILTIN_CALENDAR) => Category;
  progressLabel: (doc: EformsignDocument, calendar: typeof KR_BUILTIN_CALENDAR) => string;
  contractStageItems: (doc: EformsignDocument, category: Category, calendar: typeof KR_BUILTIN_CALENDAR) => StageItem[];
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

  it("leaves 042 / 080 as expired and keeps 040 files under the 기간 만료 filter pill", () => {
    for (const statusType of ["042", "080"]) {
      const { category, progress } = view(makeDoc({ statusType, stepType: "05", stepName: "이용자", displayStatus: "expired" }));
      expect(category).toBe("expired");
      expect(progress).toBe("기간 만료");
    }
    // FILTER_BY_CATEGORY / categoryTones live beside the helpers in page.tsx; pin them in source.
    expect(/"revoke-requested": "기간 만료"/.test(source)).toBe(true);
    expect(/case "revoke-requested":\s*return \{\s*badge: "철회 요청됨",\s*badgeTone: "orange"/.test(source)).toBe(true);
  });

  it("no longer scans histories for signature keywords", () => {
    expect(/hasCustomerSignatureDocument|CONTRACT_SIGNATURE_KEYWORDS/.test(source)).toBe(false);
  });
});
