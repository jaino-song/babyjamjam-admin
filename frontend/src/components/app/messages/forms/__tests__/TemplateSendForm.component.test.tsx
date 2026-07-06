/**
 * Component-level regression tests for TemplateSendForm.
 * Each test locks in a real bug fix. See inline comments for which bug each guards.
 *
 * Pure-helper unit tests live in TemplateSendForm.test.ts — do NOT merge them here.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { MessageLogRecord } from "@/features/message-triggers/types";
import { useMessageHistory } from "@/features/message-triggers/hooks/use-message-triggers";
import { messageDeliveryApi } from "@/services/api";
import { useFormStore } from "@/stores/form-store";

import { TemplateSendForm } from "../TemplateSendForm";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Mock ClientAutocomplete so we don't need to fight Radix Popover in JSDOM.
// Renders a plain <input> that calls onManualValueChange on change.
jest.mock("@/components/app/clients/ClientAutocomplete", () => ({
  ClientAutocomplete: ({
    label,
    manualValue,
    onManualValueChange,
  }: {
    label: string;
    manualValue?: string;
    onManualValueChange?: (v: string) => void;
  }) => (
    <input
      aria-label={label}
      value={manualValue ?? ""}
      onChange={(e) => onManualValueChange?.(e.target.value)}
      data-testid={`autocomplete-${label}`}
    />
  ),
}));

// Mock ContactInput so the phone field for requiresRecipientName templates is a plain input.
jest.mock(
  "@/components/app/messages/forms/form-components/ContactInput",
  () => ({
    ContactInput: ({
      label,
      phone,
      setPhone,
    }: {
      label: string;
      phone: string;
      setPhone: (v: string) => void;
    }) => (
      <input
        aria-label={label}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        data-testid="contact-input-phone"
      />
    ),
  }),
);

// Mock TemplateFieldGrid / TemplateFieldGridItem so children render normally.
jest.mock(
  "@/components/app/messages/forms/form-components/TemplateFieldGrid",
  () => ({
    TemplateFieldGrid: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    TemplateFieldGridItem: ({
      children,
    }: {
      children: React.ReactNode;
      dataComponent?: string;
    }) => <div>{children}</div>,
  }),
);

// Mock the message-delivery history hook (aliased in TemplateSendForm as useMessageHistory).
jest.mock(
  "@/features/message-triggers/hooks/use-message-triggers",
  () => ({
    useMessageHistory: jest.fn(),
  }),
);

// Mock the API module — only sendSms is exercised here.
jest.mock("@/services/api", () => ({
  messageDeliveryApi: {
    sendSms: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Typed references to mocks
// ---------------------------------------------------------------------------
const mockedUseMessageHistory = jest.mocked(useMessageHistory);
const mockedSendSms = jest.mocked(messageDeliveryApi.sendSms);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHistoryRecord(
  overrides: Partial<MessageLogRecord> = {},
): MessageLogRecord {
  return {
    id: 1,
    provider: "aligo_sms",
    templateKey: "SERVICE_INFO",
    triggerJobId: null,
    receiver: "010-1111-1111",
    clientId: null,
    messageBody: "안내 메시지입니다.",
    variables: {},
    status: "sent",
    aligoMid: "mid-1",
    errorMessage: null,
    attempts: 1,
    lastAttemptAt: new Date().toISOString(),
    nextRetryAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ruleId: null,
    ruleName: null,
    eventType: null,
    offsetType: null,
    offsetDays: 0,
    scheduledFor: null,
    recipientType: null,
    recipientName: null,
    clientName: null,
    employeeName: null,
    ...overrides,
  };
}

/** Default mock: empty history, no-op refetch. */
function mockEmptyHistory() {
  const refetch = jest.fn().mockResolvedValue({ data: [] });
  mockedUseMessageHistory.mockReturnValue({
    data: [],
    refetch,
  } as unknown as ReturnType<typeof useMessageHistory>);
  return refetch;
}

/** Build a success response for sendSms. */
function buildSendSuccess() {
  return {
    provider: "aligo" as const,
    triggerType: "immediate" as const,
    request: { receiver: "", msgType: "SMS" as const, testMode: false },
    result: { resultCode: 1, message: "success", errorCount: 0 },
  };
}

/** Build a failure response for sendSms (resultCode !== 1). */
function buildSendFailure() {
  return {
    provider: "aligo" as const,
    triggerType: "immediate" as const,
    request: { receiver: "", msgType: "SMS" as const, testMode: false },
    result: { resultCode: 0, message: "failed", errorCount: 1 },
  };
}

/**
 * Render the form with a simple non-name-requiring template.
 * "builtin:info" uses the inline phone recipient layout (no name required).
 */
function renderInfoForm() {
  return render(
    <TemplateSendForm
      templateId="builtin:info"
      templateName="서비스 안내"
      message="안내 메시지입니다."
    />,
  );
}

/**
 * Render the form with requiresRecipientName=true (e.g. greeting/thanks template).
 */
function renderNameRequiredForm() {
  return render(
    <TemplateSendForm
      templateId="builtin:greeting"
      templateName="인사 메시지"
      message="안내 메시지입니다."
      requiresRecipientName
    />,
  );
}

/**
 * Queue a recipient by directly manipulating the Zustand store.
 * The component's useEffect auto-queues when currentQueueItem changes.
 */
async function queueRecipient(phone: string, name = "") {
  await act(async () => {
    useFormStore.setState({ phone, name });
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  // Reset Zustand store to blank state between tests.
  useFormStore.setState({
    clientId: null,
    name: "",
    phone: "",
    birthday: "",
    dueDate: "",
    address: "",
    startDate: "",
    endDate: "",
    fullPrice: "",
    grant: "",
    actualPrice: "",
    voucherType: "",
    voucherDuration: "",
    area: "",
  });
  mockEmptyHistory();
});

// ---------------------------------------------------------------------------
// BUG FIX A — Partial-failure send must NOT re-queue already-sent recipients.
//
// Before the fix: all recipients were re-queued on any failure, causing
// already-sent recipients to be re-sent on retry.
// After the fix: only failed recipients remain in the queue; succeeded
// recipients are removed so retrying re-sends only the failure.
// ---------------------------------------------------------------------------
describe("A: partial-failure send keeps only failed recipients in queue", () => {
  it("removes the succeeded recipient and keeps only the failed one after a mixed result", async () => {
    renderInfoForm();

    // Queue recipient 1 (01011111111 → 010-1111-1111) then recipient 2.
    await queueRecipient("01011111111");
    await queueRecipient("01022222222");

    await waitFor(() => {
      expect(
        document.querySelectorAll('[data-component="messages-template-send-form-recipient"]').length,
      ).toBe(2);
    });

    // sendSms: recipient 1 succeeds, recipient 2 fails (rejects).
    mockedSendSms.mockImplementation(
      (payload) => {
        if (payload.receiver === "010-1111-1111") {
          return Promise.resolve(buildSendSuccess());
        }
        return Promise.reject(new Error("send failed"));
      },
    );

    // Submit the form.
    const submitButton = screen.getByRole("button", { name: /즉시 발송/ });
    fireEvent.click(submitButton);

    // Wait for async send to complete.
    await waitFor(() => {
      // Feedback element should be visible with partial summary.
      expect(
        document.querySelector('[data-component="messages-template-send-form-feedback"]'),
      ).toBeInTheDocument();
    });

    const feedback = document.querySelector(
      '[data-component="messages-template-send-form-feedback"]',
    );

    // Feedback must mention both 발송 완료 and 실패 (partial summary).
    expect(feedback?.textContent).toContain("발송 완료");
    expect(feedback?.textContent).toContain("실패");

    // Only the FAILED recipient (010-2222-2222) must remain in the queue.
    // The succeeded recipient (010-1111-1111) must be gone.
    const remainingPills = document.querySelectorAll(
      '[data-component="messages-template-send-form-recipient"]',
    );
    expect(remainingPills).toHaveLength(1);
    expect(remainingPills[0].textContent).toContain("010-2222-2222");
    expect(remainingPills[0].textContent).not.toContain("010-1111-1111");
  });

  it("removes succeeded recipients even when sendSms resolves with a non-1 resultCode for another", async () => {
    renderInfoForm();

    await queueRecipient("01011111111");
    await queueRecipient("01022222222");

    await waitFor(() => {
      expect(
        document.querySelectorAll('[data-component="messages-template-send-form-recipient"]').length,
      ).toBe(2);
    });

    // Recipient 1 succeeds; recipient 2 resolves but with resultCode=0 (failure result object).
    mockedSendSms.mockImplementation(
      (payload) => {
        if (payload.receiver === "010-1111-1111") {
          return Promise.resolve(buildSendSuccess());
        }
        return Promise.resolve(buildSendFailure());
      },
    );

    fireEvent.click(screen.getByRole("button", { name: /즉시 발송/ }));

    await waitFor(() => {
      expect(
        document.querySelector('[data-component="messages-template-send-form-feedback"]'),
      ).toBeInTheDocument();
    });

    const feedback = document.querySelector(
      '[data-component="messages-template-send-form-feedback"]',
    );
    expect(feedback?.textContent).toContain("발송 완료");
    expect(feedback?.textContent).toContain("실패");

    const remainingPills = document.querySelectorAll(
      '[data-component="messages-template-send-form-recipient"]',
    );
    expect(remainingPills).toHaveLength(1);
    expect(remainingPills[0].textContent).toContain("010-2222-2222");
  });
});

// ---------------------------------------------------------------------------
// BUG FIX C — Duplicate-send confirm dialog must surface ALL duplicates.
//
// Before the fix: only the first duplicate was detected; additional duplicates
// were silently omitted.
// After the fix: every queued recipient with a matching recent "sent" history
// record appears in the confirm dialog list.
// ---------------------------------------------------------------------------
describe("C: duplicate-send confirm dialog lists all duplicates (not just the first)", () => {
  it("shows one confirm-recent entry per duplicate recipient and pluralizes the description", async () => {
    const message = "안내 메시지입니다.";

    // History records that match BOTH queued recipients.
    const historyForRecipient1 = buildHistoryRecord({
      id: 101,
      receiver: "010-1111-1111",
      messageBody: message,
      status: "sent",
      lastAttemptAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h ago
    });
    const historyForRecipient2 = buildHistoryRecord({
      id: 102,
      receiver: "010-2222-2222",
      messageBody: message,
      status: "sent",
      lastAttemptAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    });

    // refetch returns both matching history records.
    const refetch = jest
      .fn()
      .mockResolvedValue({ data: [historyForRecipient1, historyForRecipient2] });
    mockedUseMessageHistory.mockReturnValue({
      data: [historyForRecipient1, historyForRecipient2],
      refetch,
    } as unknown as ReturnType<typeof useMessageHistory>);

    renderInfoForm();

    // Queue both recipients.
    await queueRecipient("01011111111");
    await queueRecipient("01022222222");

    await waitFor(() => {
      expect(
        document.querySelectorAll('[data-component="messages-template-send-form-recipient"]').length,
      ).toBe(2);
    });

    // sendSms should NOT be called — we expect the duplicate dialog to intercept.
    mockedSendSms.mockResolvedValue(buildSendSuccess());

    // Submit the form.
    fireEvent.click(screen.getByRole("button", { name: /즉시 발송/ }));

    // Wait for the duplicate confirm dialog to appear.
    await waitFor(() => {
      expect(
        document.querySelector('[data-component="messages-duplicate-send-confirm-dialog"]'),
      ).toBeInTheDocument();
    });

    // The duplicate list must contain exactly 2 entries — one per duplicate recipient.
    const confirmList = document.querySelector(
      '[data-component="messages-duplicate-send-confirm-list"]',
    );
    expect(confirmList).toBeInTheDocument();

    const recentItems = document.querySelectorAll(
      '[data-component="messages-duplicate-send-confirm-recent"]',
    );
    expect(recentItems).toHaveLength(2);

    // The dialog description must mention "2건" (plural).
    const dialogDescription = document.querySelector('[data-component="messages-duplicate-send-confirm-header"]');
    expect(dialogDescription?.textContent).toContain("2건");

    // sendSms must NOT have been called (dialog intercepted the send).
    expect(mockedSendSms).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// BUG FIX B — requiresRecipientName template: name edit updates queued entry.
//
// Before the fix: updating the name for an already-queued phone silently dropped
// the correction — the queued entry kept the stale name.
// After the fix: the queued entry is updated in place via a targeted array splice.
// ---------------------------------------------------------------------------
describe("B: editing name for already-queued phone updates the pill in place", () => {
  it("updates the queued recipient name when the same phone is re-queued with a new name", async () => {
    renderNameRequiredForm();

    // Queue recipient with initial name.
    await queueRecipient("01011111111", "김철수");

    // Pill should show initial name.
    await waitFor(() => {
      const pills = document.querySelectorAll(
        '[data-component="messages-template-send-form-recipient"]',
      );
      expect(pills).toHaveLength(1);
      expect(pills[0].textContent).toContain("김철수");
    });

    // Change only the name (same phone) — the in-place update fix handles this.
    await queueRecipient("01011111111", "김영희");

    // Queue must still have exactly 1 entry (no duplicate), and name is corrected.
    await waitFor(() => {
      const pills = document.querySelectorAll(
        '[data-component="messages-template-send-form-recipient"]',
      );
      expect(pills).toHaveLength(1);
      expect(pills[0].textContent).toContain("김영희");
      expect(pills[0].textContent).not.toContain("김철수");
    });
  });
});
