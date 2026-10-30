import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const frontendRoot = path.resolve(__dirname, "..");
const readSource = (...segments: string[]) =>
  fs.readFileSync(path.join(frontendRoot, ...segments), "utf8");

test.describe("contract document jobs wiring", () => {
  test("always queues creation, including re-issue, and never opens the eformsign editor", () => {
    const source = readSource("src", "components", "app", "contracts", "ContractCreationForm.tsx");
    expect(source).toContain("useEnqueueEformsignDocumentCreation");
    expect(source).toContain("enqueueCreationMutation.mutateAsync({ ...request, requestKey })");
    expect(source).toContain("creationRequestRef");
    expect(source).toContain("JSON.stringify(request)");
    expect(source).toContain("{ supersedeDocumentId }");
    expect(source).toContain('"전자문서 생성을 시작했어요"');
    expect(source).toContain('"계약서 재발행을 시작했어요"');
    // The synchronous / manual iframe paths were removed; staff recover a failed job from the 처리중 list.
    expect(source).not.toContain("dispatchHeadless");
    expect(source).not.toContain("eformsignApi.generateDocument");
    expect(source).not.toContain("shouldEnqueueDocumentJob");
    expect(source).not.toContain('mode: "manual"');
    expect(source).not.toContain("eformsign_iframe");
  });

  test("queues finalization by default and recovers failed jobs from the 처리중 list", () => {
    const source = readSource("src", "app", "(protected)", "contracts", "page.tsx");
    expect(source).toContain("useEnqueueEformsignDocumentFinalization");
    expect(source).toContain("enqueueFinalizationMutation.mutateAsync");
    expect(source).toContain("requestKey: createFinalizeProgressId()");
    expect(source).toContain("if (existing && (status === \"failed\" || status === \"requires_attention\"))");
    expect(source).toContain("setIsFinalizeOpen(false)");
    expect(source).toContain("<DocumentJobRecoveryDialog");
    expect(source).toContain("showDocumentJobs={true}");
    // The direct SDK / headless finalize paths and the opt-in flag are gone.
    expect(source).not.toContain("generateStaffDocument");
    expect(source).not.toContain("finalizeHeadless");
    expect(source).not.toContain("documentJobsEnabled");
  });

  test("reads the active job count from the app-wide jobs provider", () => {
    const providerSource = readSource("src", "features", "document-jobs", "DocumentJobsProvider.tsx");
    const statsSource = readSource("src", "components", "app", "contracts", "ContractStatsBar.tsx");
    const miniSource = readSource("src", "components", "app", "contracts", "DocumentJobsStatMini.tsx");

    expect(providerSource).toContain("useEformsignDocumentJobsSummary(isAuthenticated)");
    expect(statsSource).toContain("<DocumentJobsStatMini");
    expect(statsSource).toContain("showDocumentJobs = true");
    expect(miniSource).toContain("useDocumentJobs()");
  });
});
