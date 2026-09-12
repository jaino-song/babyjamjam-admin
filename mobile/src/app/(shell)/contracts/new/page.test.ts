import fs from "node:fs";
import { createProblemDetails } from "@babyjamjam/shared";

import {
  buildContractSubmissionAlert,
  canUseContractIframeFallback,
  focusContractValidationErrors,
  isHeadlessSuccessResponse,
  isValidIframeSuccessResponse,
} from "./page.helpers";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("mobile contract creation compensation flow", () => {
  it("does not navigate after adoption leaves the local mirror incomplete", () => {
    const branch = source.slice(
      source.indexOf('headless.reason === "local_persist_failed"'),
      source.indexOf('headless.reason === "remote_unconfirmed"'),
    );

    expect(branch).toContain('adopted.warnings?.includes("mirror_sync_failed")');
    expect(branch).toContain("전자문서와 PDF 동기화가 완료되지 않았습니다.");
    expect(branch).toContain("completed: false");
    expect(branch).toContain("failed: true");
    const warningBranch = branch.slice(
      branch.indexOf('adopted.warnings?.includes("mirror_sync_failed")'),
      branch.indexOf("return;", branch.indexOf('adopted.warnings?.includes("mirror_sync_failed")')),
    );
    expect(warningBranch).toContain(
      "queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() })",
    );
    expect(branch.indexOf('adopted.warnings?.includes("mirror_sync_failed")'))
      .toBeLessThan(branch.indexOf('router.push("/contracts")'));
  });

  it("allows the iframe only for a server-declared pre-send failure", () => {
    expect(canUseContractIframeFallback({
      fallbackHint: "iframe",
      failedStep: "info-inserted",
      reason: "template_navigation_failed",
    })).toBe(true);
    expect(canUseContractIframeFallback({
      fallbackHint: "iframe",
      failedStep: "creating",
      reason: "template_navigation_failed",
    })).toBe(true);
    expect(canUseContractIframeFallback({
      fallbackHint: "iframe",
      reason: "template_navigation_failed",
    })).toBe(true);
    expect(canUseContractIframeFallback({
      fallbackHint: "iframe",
      failedStep: "info-inserted",
      reason: "remote_unconfirmed",
    })).toBe(false);
    expect(canUseContractIframeFallback({
      fallbackHint: "iframe",
      failedStep: "info-inserted",
      reason: "local_persist_failed",
    })).toBe(false);
    expect(canUseContractIframeFallback({
      fallbackHint: "iframe",
      failedStep: "info-inserted",
      reason: "manual_check",
    })).toBe(false);
  });

  it("accepts only complete provider success shapes", () => {
    expect(isHeadlessSuccessResponse({ ok: true, documentId: "doc-1", durationMs: 12 })).toBe(true);
    expect(isHeadlessSuccessResponse({ ok: true, documentId: "doc-1" })).toBe(false);
    expect(isHeadlessSuccessResponse({ ok: true, documentId: "", durationMs: 12 })).toBe(false);
    expect(isHeadlessSuccessResponse({ ok: true, documentId: "doc-1", durationMs: -1 })).toBe(false);
    expect(isValidIframeSuccessResponse({ code: "-1", document_id: "doc-2" })).toBe(true);
    expect(isValidIframeSuccessResponse({ code: "-1" })).toBe(false);
  });

  it("keeps typed validation safe while retaining request ids and focusing represented fields", () => {
    const problem = createProblemDetails({
      code: "VALIDATION_FAILED",
      outcome: "NOT_APPLIED",
      requestId: "request-123",
      status: 400,
      errors: [{ pointer: "/contractData/customerContact", code: "INVALID_FORMAT", detail: "raw provider detail" }],
    });
    const alert = buildContractSubmissionAlert(problem);
    expect(alert.verified).toBe(true);
    expect(alert.requestId).toBe("request-123");
    expect(alert.outcome).toBe("NOT_APPLIED");
    expect(alert.locked).toBe(false);
    expect(alert.message).not.toContain("raw provider detail");

    const input = document.createElement("input");
    input.setAttribute("data-component", "mobile_contracts-new_screen_root_page_root_form-scroll_card_phone-input");
    document.body.append(input);
    const setStep = jest.fn();
    expect(focusContractValidationErrors(problem.errors, setStep)).toBe("customerContact");
    expect(setStep).toHaveBeenCalledWith(0);
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it("does not infer an unapplied mutation from a client-error status", () => {
    const problem = createProblemDetails({ code: "REQUEST_CONFLICT", requestId: "request-no-outcome" });
    const alert = buildContractSubmissionAlert({ ...problem, outcome: undefined });
    expect(alert.outcome).toBe("UNKNOWN");
    expect(alert.locked).toBe(true);
  });

  it("locks an unverified mutation outcome and never offers a blind retry", () => {
    const alert = buildContractSubmissionAlert(new Error("provider response lost"));
    expect(alert.outcome).toBe("UNKNOWN");
    expect(alert.locked).toBe(true);
    expect(alert.message).toContain("계약 목록에서 상태를 확인해 주세요");
  });
});
