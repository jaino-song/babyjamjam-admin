import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("mobile contracts action lifecycle", () => {
  it("keeps every detail info row mounted and skeletonizes its value during the initial detail request", () => {
    const basicPanelStart = source.indexOf(
      '<MobileDetailTabPanel data-component="mobile_contracts_detail-sheet_stack_detail-page_tab-panel"',
    );
    const signersPanelStart = source.indexOf(
      '<MobileDetailTabPanel data-component="mobile_contracts_detail-sheet_stack_detail-page_tab-panel-2"',
    );
    const messagesPanelStart = source.indexOf(
      '<MobileDetailTabPanel data-component="mobile_contracts_detail-sheet_stack_detail-page_tab-panel-3"',
    );
    const basicPanelSource = source.slice(basicPanelStart, signersPanelStart);
    const signersPanelSource = source.slice(signersPanelStart, messagesPanelStart);

    expect(source).toContain("isPending: isSelectedDocDetailLoading");
    expect(source).toContain("isDetailLoading={isSelectedDocDetailLoading}");
    // Basic tab: 이용자 정보 (3) + 서비스 정보 (6) + 서비스 비용 (4)
    expect(basicPanelSource.match(/<InfoRow/g)).toHaveLength(13);
    expect(basicPanelSource.match(/<InfoCard[^>]*isLoading=\{isDetailLoading\}/g)).toHaveLength(3);
    expect(basicPanelSource).not.toMatch(/<InfoRow[^>]*isLoading=/);
    expect(basicPanelSource).not.toContain("{customerPhone ? (");
    // Signers tab: 계약 정보 (5) sits above the 계약서 단계 timeline, so its rows
    // stay skeletonized there during the initial detail request.
    expect(signersPanelSource.match(/<InfoRow/g)).toHaveLength(5);
    expect(signersPanelSource.match(/<InfoCard[^>]*isLoading=\{isDetailLoading\}/g)).toHaveLength(1);
    expect(signersPanelSource).not.toMatch(/<InfoRow[^>]*isLoading=/);
    expect(signersPanelSource.indexOf("mobile_contracts_detail-panel_info-card-2")).toBeLessThan(
      signersPanelSource.indexOf("mobile_contracts_detail-panel_info-card-3"),
    );
  });

  it("normalizes contract phone values through the shared Korean phone formatter", () => {
    expect(source).toContain('import { formatKoreanPhoneNumber } from "@/lib/phone";');
    expect(source).toContain("formatKoreanPhoneNumber(value)");
    // Mutant that must fail: restoring the old local digit slicer, which rendered
    // a raw 82 country-code prefix (821-0454-7742) instead of the 010 form.
    expect(source).not.toContain("digits.slice(7, 11)");
  });

  it("locks document deletion through the required cache refresh", () => {
    expect(source).toContain("const [isDeletingDocument, setIsDeletingDocument] = useState(false)");
    expect(source).toContain(
      "const isDeleteDocumentBusy = isDeletingDocument || deleteDocument.isPending",
    );
    expect(source).toContain("if (!deleteTargetDoc || isDeleteDocumentBusy) return");
    expect(source).toContain("loading={isDeleteDocumentBusy}");
    expect(source).toContain("setIsDeletingDocument(false)");
  });

  it("keeps finalization busy through success progress and iframe handoff", () => {
    expect(source).toContain("const closeStaffIframe = useCallback(() =>");
    expect(source).toContain("let keepFinalizeSubmittingUntilIframeCloses = false");
    expect(source).toContain("keepFinalizeSubmittingUntilIframeCloses = true");
    expect(source).toContain("if (!keepFinalizeSubmittingUntilIframeCloses)");
    expect(source).toContain("setIsFinalizeSubmitting(false)");
  });

  it("does not open the iframe when finalization needs a manual status check", () => {
    expect(source).toContain("let transportOutcomeUnknown = false");
    expect(source).toContain("transportOutcomeUnknown = true");
    expect(source).toContain(
      "shouldOpenFinalizeIframe(fallbackHint, transportOutcomeUnknown)",
    );
    expect(source).toContain("parseFinalizeHeadlessResult(headless)");
    expect(source).toContain("setIsFinalizeProgressOpen(false)");
    expect(source).not.toContain('console.warn("[finalize]');
  });

  // BJJ-319 5-4c: the envelope `outcome` is classified inside
  // parseFinalizeHeadlessResult (guard test covers it); the page must keep
  // settling every ok:false through that guard rather than reading
  // `outcome` or `fallbackHint` off the envelope directly.
  it("routes the finalize envelope through the outcome-aware guard classification", () => {
    expect(source).toContain("parseFinalizeHeadlessResult(headless)");
    expect(source).not.toContain("headless.fallbackHint");
    expect(source).not.toContain("headless.outcome");
    // UNKNOWN settles through the blocked presentation (확인 필요 + no replay),
    // so the iframe handoff decision stays keyed on the guard's verdict.
    expect(source).toContain('headlessResult.kind === "iframe" ? "iframe" : undefined');
  });

  it("wires the receipt-link send action through a busy confirm modal", () => {
    expect(source).toContain("setIsSendingReceiptLink(true)");
    expect(source).toContain("disabled: isSendingReceiptLink");
    expect(source).toContain(
      "mobile_contracts_detail-sheet_stack_detail-page_actions_receipt-send",
    );
    expect(source).toContain(
      "mobile_contracts_detail-sheet_stack_detail-page_dialogs_receipt-send-confirm",
    );
    expect(source).toContain(
      "`${result.clientName} 산모님께 1분 내 발송됩니다. 링크는 30일간 유효합니다.`",
    );
  });

  // Textual pin, not a render test (see audit brief F2): the trigger's onClick only
  // opens the confirm modal — it must never call eformsignApi.sendReceiptLink or the
  // handleSendReceiptLink mutation itself. Mutant that must fail: the action's onClick
  // becoming a no-op (or calling the mutation directly, skipping the confirm modal).
  it("pins the receipt-send trigger to opening the confirm modal, and the modal's approve action to the guarded send mutation", () => {
    expect(source).toContain("onClick: () => setIsReceiptSendConfirmOpen(true)");
    expect(source).toContain("onApprove={handleSendReceiptLink}");
    expect(source).toContain(
      "const handleSendReceiptLink = async () => {\n    if (isReceiptSendBlocked) return;\n    setIsSendingReceiptLink(true);",
    );
    expect(source).toContain("onSendReceiptLink={handleReceiptLinkSend}");
    expect(source).toContain("if (!beginContractMutation(\"receipt\", doc.id)) return;");
    expect(source).toContain("const result = parseReceiptLinkResult(await eformsignApi.sendReceiptLink(doc.id));");
    expect(source).toContain("normalizeContractMutationError(error, \"receipt\", doc.id)");
  });

  it("renders persistent mutation outcomes with the shared alert presentation and date target", () => {
    expect(source).toContain("<Alert");
    expect(source).toContain("dataComponents={{");
    expect(source).toContain("resolveProblemPresentation(\"ko-KR\")");
    expect(source).toContain("id={CONTRACT_FINALIZE_END_DATE_INPUT_ID}");
    expect(source).toContain("onRefreshMutationOutcome={refreshMutationOutcome}");
  });

  it("blanks the shared UNKNOWN_CUSTOMER_NAME placeholder before building the receipt-send confirm copy (F6)", () => {
    expect(source).toContain(
      "const receiptSendCustomerName =\n    resolvedCustomerName === UNKNOWN_CUSTOMER_NAME ? \"\" : resolvedCustomerName;",
    );
    expect(source).toContain(
      "description={`${receiptSendCustomerName ? `${receiptSendCustomerName} 산모님께 ` : \"\"}본인부담금 영수증 링크가 담긴 문자를 1분 내 발송합니다.",
    );
  });

  // Textual pin (audit-b fix round 1, I1 + signed-gate): ContractDetailContent is
  // shared with the 제공기록지 (service-record) detail — isServiceRecord gates the
  // service-record case out, and the shared signed gate hides the action for
  // documents the backend would still reject with contract_not_signed. Mutants that
  // must fail: removing the isServiceRecord gate or the isContractReceiptSendable
  // gate around the action entry.
  it("gates the receipt-send action out of the 제공기록지 detail and unsigned documents (I1 + signed gate)", () => {
    expect(source).toContain(
      "...(isServiceRecord ||\n                  !isContractReceiptSendable({\n                    displayStatus: doc.display_status,",
    );
    expect(source).toContain(
      "contractEndDate: doc.contract_end_date,\n                  })\n                    ? []\n                    : [",
    );
    expect(source).toContain('label: "영수증 문자 발송",');
  });

  it("routes both prefill flows through the shared contract transformer and keeps service dates on the existing normalizer", () => {
    expect(source).toContain("return buildContractClientPrefill({");
    expect(source).toContain("return buildContractCreationPrefillFromClient({");
    expect(source).toContain("birthday: documentFieldValue(doc, [\"생년월일\"");
    expect(source).toContain("clientPrefill,");
    expect(source).toContain("const dueDate = normalizeDateToYymmdd(");
    expect(source).toContain("const startDate = normalizeDateToYymmdd(");
    expect(source).toContain("const endDate = normalizeDateToYymmdd(");
    expect(source).toContain("dueDate: yymmddPrefillToIso(clientPrefill.dueDate),");
    expect(source).toContain("useContractClientRegistration");
    expect(source).not.toContain("setPrefillClient(buildClientPrefillFromContract(doc));");
    expect(source).toContain(
      "prefillContractCreation(buildContractCreationPrefillFromContract(doc, metadata, employees));",
    );
    expect(source).toContain("url: receiptDownloadUrl,\n        fileName: receiptFilename,");
    expect(source).toContain("fileName: receiptFilename,");
    expect(source).toContain(
      "onDownload: (url, fileName, binary) => downloadReceiptPng(url, fileName, undefined, binary),",
    );
  });

  it("cancels stale document binary actions when the selected contract changes", () => {
    expect(source).toContain(
      "const downloadControllers = downloadControllersRef.current;",
    );
    expect(source).toContain("downloadControllers.forEach((controller) => controller.abort());");
    expect(source).toContain("receiptShareControllerRef.current?.abort();");
    expect(source).toContain("receiptShareInFlightRef.current = false;");
    expect(source).toContain("}, [doc.id]);");
  });

  it("never assigns protected contract binaries directly to anchor hrefs", () => {
    expect(source).not.toContain("href={receiptDownloadUrl}");
    expect(source).not.toContain("href={downloadUrl}");
    expect(source).toContain("onClick={handleReceiptDownload}");
    expect(source).toContain("onClick={handlePdfDownload}");
  });
});
