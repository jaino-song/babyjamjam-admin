import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const frontendRoot = path.resolve(__dirname, "..");
const readSource = (...segments: string[]) =>
  fs.readFileSync(path.join(frontendRoot, ...segments), "utf8");

test.describe("contract document jobs wiring", () => {
  test("always queues non-manual creation including re-issue", () => {
    const source = readSource("src", "components", "app", "contracts", "ContractCreationForm.tsx");
    expect(source).toContain('const shouldEnqueueDocumentJob = mode !== "manual"');
    expect(source).toContain("useEnqueueEformsignDocumentCreation");
    expect(source).toContain("creationRequestRef");
    expect(source).toContain("JSON.stringify(request)");
    expect(source).toContain("{ supersedeDocumentId }");
    expect(source).toContain('"전자문서 생성을 시작했어요"');
    expect(source).toContain('"계약서 재발행을 시작했어요"');
    expect(source).not.toContain("dispatchHeadless");
    expect(source).toContain("eformsignApi.generateDocument");
    expect(source).toContain('mode: "manual"');
  });

  test("queues finalization by default and retains explicit direct recovery", () => {
    const source = readSource("src", "app", "(protected)", "contracts", "page.tsx");
    expect(source).toContain("useEnqueueEformsignDocumentFinalization");
    expect(source).toContain('path = "queue"');
    expect(source).toContain('if (path === "queue")');
    expect(source).toContain('path: "direct"');
    expect(source).toContain("requestKey: createFinalizeProgressId()");
    expect(source).toContain('return { kind: "queued" }');
    expect(source).toContain("setIsFinalizeOpen(false)");
    expect(source).toContain("generateStaffDocument");
    expect(source).toContain("showDocumentJobs={true}");
    expect(source).not.toContain("documentJobsEnabled");
    expect(source).toContain("documentJobsQuery.summary");
  });
});
