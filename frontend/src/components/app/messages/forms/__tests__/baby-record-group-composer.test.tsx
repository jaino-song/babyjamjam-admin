import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ServiceRecordLinkResetDialog } from "@/components/app/clients/ServiceRecordLinkResetDialog";
import { serviceRecordsApi } from "@/features/service-records/api/service-records.api";
import { serviceRecordKeys } from "@/features/service-records/hooks/keys";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { eformsignApi } from "@/services/api";
import { useFormStore } from "@/stores/form-store";
import type { AdminServiceRecordCaseSummary, ServiceRecordOverview } from "@babyjamjam/shared/types/service-record";

import { ServiceRecordLinkMessageForm } from "../ServiceRecordLinkMessageForm";
import { TemplateSendForm } from "../TemplateSendForm";

jest.mock("@/features/system-templates/hooks", () => ({ useSystemTemplate: jest.fn() }));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/features/service-records/api/service-records.api", () => ({
  serviceRecordsApi: { getClientOverview: jest.fn(), prepareLink: jest.fn(), sendLink: jest.fn(), resetLink: jest.fn() },
}));
jest.mock("@/services/api", () => ({
  messageDeliveryApi: {},
  eformsignApi: { prepareReceiptLink: jest.fn(), sendReceiptLink: jest.fn() },
}));
jest.mock("@/components/app/clients/EmployeeAutocomplete", () => ({
  EmployeeAutocomplete: ({ onChange, onManualInputChange }: {
    onChange: (id: number, employee: unknown) => void;
    onManualInputChange: (name: string) => void;
  }) => (
    <>
      <button type="button" onClick={() => onChange(31, { name: "주관리사", phone: "01011112222" })}>주관리사 선택</button>
      <button type="button" onClick={() => onChange(32, { name: "보조관리사", phone: "01033334444" })}>보조관리사 선택</button>
      <button type="button" onClick={() => onManualInputChange("수동 관리사")}>관리사 수동 입력</button>
    </>
  ),
}));
jest.mock("@/components/app/clients/ClientAutocomplete", () => ({
  ClientAutocomplete: ({ onChange }: { onChange: (id: number, client: unknown) => void }) => (
    <button type="button" onClick={() => onChange(20, { name: "테스트 산모", phone: "01055556666" })}>산모 선택</button>
  ),
}));
jest.mock("../../templates/AutoFillMsgCard", () => ({
  AutoFillMsgCard: ({ message }: { message: string }) => <pre aria-label="메시지 미리보기">{message}</pre>,
}));

const scheduleId = 11;
const caseIds = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
];
const expiry = "2099-12-20T15:00:00.000Z";
const api = jest.mocked(serviceRecordsApi);

function overview(secondEmployee = 31, secondVersion = 7): ServiceRecordOverview {
  return {
    legacyLinkAssignment: null, record: null, assignments: [],
    cases: caseIds.map((caseId, index): AdminServiceRecordCaseSummary => {
      const employeeId = index === 0 ? 31 : secondEmployee;
      return {
        caseId, babyId: `20000000-0000-4000-8000-00000000000${index + 1}`,
        rank: index + 1, babyCount: 2, legacyName: null, retired: false, status: "IN_PROGRESS",
        assignees: [{ id: employeeId, name: employeeId === 31 ? "주관리사" : "보조관리사" }],
        linkAssignments: [{ scheduleId, employeeId, assignmentVersion: index === 0 ? 3 : secondVersion }],
        totalSessions: 5, submittedSessions: 0,
      };
    }),
    scheduleProjection: { entries: [], blockingReasons: [] },
  };
}

function prepared(employeeId: number, selection: number[], secondVersion = 7) {
  const members = selection.map((index) => {
    const preparedLinkToken = `efl_${(index === 0 ? "A" : "B").repeat(42)}${secondVersion % 10}`;
    return {
      caseId: caseIds[index], babyId: `20000000-0000-4000-8000-00000000000${index + 1}`,
      activeRank: index + 1, assignmentVersion: index === 0 ? 3 : secondVersion,
      serviceRecordUrl: `https://example.test/service-record/${preparedLinkToken}`, preparedLinkToken, expiresAt: expiry,
    };
  });
  return {
    kind: "group" as const, employeeId, householdBabyCount: 2, members, buttonUrl: null,
    previewContent: members.map((member) =>
      `${member.activeRank === 1 ? "첫째" : "둘째"} 아기 제공기록지\n${member.serviceRecordUrl}`).join("\n\n"),
  };
}

function renderComposer(mode: "service-feedback-link" | "receipt-link" = "service-feedback-link", resetCaseId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Composer() {
    const [message, setMessage] = useState("");
    const [resetCase, setResetCase] = useState<string>();
    return (
      <>
        <ServiceRecordLinkMessageForm mode={mode} onPreviewMessageChange={setMessage}
          renderLayout={({ fields, messageCard, ...layout }) => (
            <>
              <TemplateSendForm {...layout} templateId="system-link" templateName="링크" message={message}>
                {fields}
              </TemplateSendForm>
              {messageCard}
            </>
          )}
        />
        {resetCaseId ? (
          <button type="button" onClick={() => setResetCase(resetCaseId)}>둘째 아기 링크 재설정 열기</button>
        ) : null}
        <ServiceRecordLinkResetDialog dataComponent="desktop_clients_detail_reset-link"
          target={resetCase ? { clientId: 20, caseId: resetCase, scheduleId: 11, employeeId: 31 } : null} onClose={() => setResetCase(undefined)} />
      </>
    );
  }
  render(<QueryClientProvider client={client}><Composer /></QueryClientProvider>);
  return client;
}

const send = () => screen.getByRole("button", { name: "즉시 발송" });
const preview = () => screen.getByLabelText("메시지 미리보기").textContent;
const select = (name = "주관리사 선택") => {
  fireEvent.click(screen.getByRole("button", { name }));
  fireEvent.click(screen.getByRole("button", { name: "산모 선택" }));
};

function mockReset(secondVersion: number) {
  const [{ caseId, babyId, activeRank, assignmentVersion, serviceRecordUrl, expiresAt }] = prepared(31, [1], secondVersion).members;
  const second = { caseId, babyId, activeRank, assignmentVersion, serviceRecordUrl, expiresAt };
  api.resetLink.mockResolvedValue({ data: { kind: "group", employeeId: 31, members: [second] } } as never);
  return second;
}

async function resetSecond() {
  fireEvent.click(screen.getByRole("button", { name: "둘째 아기 링크 재설정 열기" }));
  const approval = await screen.findByRole("dialog", { name: /재설정하시겠습니까/ });
  fireEvent.click(within(approval).getByRole("button", { name: "링크 재설정" }));
}

const originalResizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterAll(() => { globalThis.ResizeObserver = originalResizeObserver; });

beforeEach(() => {
  jest.resetAllMocks();
  document.cookie = "selected_branch_id=branch-a; path=/";
  useFormStore.getState().resetAll();
  jest.mocked(useSystemTemplate).mockReturnValue({
    data: { content: "{{serviceRecordLinks}}", requiredVariables: [{ key: "serviceRecordLinks", label: "아기별 제공기록지" }] },
  } as never);
  api.getClientOverview.mockResolvedValue({ data: overview() } as never);
  api.sendLink.mockResolvedValue({ data: { status: "sent" } } as never);
});

it("the composer prepares one employee with both assigned cases", async () => {
  const response = prepared(31, [0, 1]);
  api.prepareLink.mockResolvedValue({ data: response } as never);
  renderComposer();
  expect(send()).toBeDisabled();
  select();
  await waitFor(() => expect(preview()).toBe(response.previewContent));
  expect(screen.getByRole("checkbox", { name: "첫째 아기" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "둘째 아기" })).toBeChecked();
  expect(api.prepareLink).toHaveBeenCalledTimes(1);
  expect(api.prepareLink).toHaveBeenCalledWith(11, { employeeId: 31, caseIds, recipientPhone: "01011112222" });
  fireEvent.click(send());
  expect(api.sendLink.mock.calls).toEqual([[11, {
    employeeId: 31, recipientPhone: "01011112222",
    members: response.members.map(({ caseId, assignmentVersion, preparedLinkToken }) =>
      ({ caseId, assignmentVersion, preparedLinkToken })),
  }]]);
});

it("the assistant sees only the selected baby and server preview", async () => {
  api.getClientOverview.mockResolvedValue({ data: overview(32) } as never);
  const response = prepared(32, [1]);
  api.prepareLink.mockResolvedValue({ data: response } as never);
  renderComposer();
  select("보조관리사 선택");
  await waitFor(() => expect(preview()).toBe(response.previewContent));
  expect(screen.queryByRole("checkbox", { name: "첫째 아기" })).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "둘째 아기" })).toBeChecked();
  expect(api.prepareLink).toHaveBeenCalledWith(11, { employeeId: 32, caseIds: [caseIds[1]], recipientPhone: "01033334444" });
  fireEvent.click(send());
  expect(api.sendLink).toHaveBeenCalledWith(11, {
    employeeId: 32, recipientPhone: "01033334444",
    members: [{ caseId: caseIds[1], assignmentVersion: 7, preparedLinkToken: response.members[0].preparedLinkToken }],
  });
});

it("a stale preparation cannot submit after changing the selected employee", async () => {
  const primary = prepared(31, [0]);
  const assistant = prepared(32, [1]);
  let resolvePrimary!: (value: { data: typeof primary }) => void;
  const primaryRequest = new Promise<{ data: typeof primary }>((resolve) => { resolvePrimary = resolve; });
  api.getClientOverview.mockResolvedValue({ data: overview(32) } as never);
  api.prepareLink.mockReturnValueOnce(primaryRequest as never).mockResolvedValueOnce({ data: assistant } as never);
  renderComposer();
  select();
  await waitFor(() => expect(api.prepareLink).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "보조관리사 선택" }));
  expect(send()).toBeDisabled();
  fireEvent.click(send());
  expect(api.sendLink).not.toHaveBeenCalled();
  await waitFor(() => expect(preview()).toBe(assistant.previewContent));
  await act(async () => resolvePrimary({ data: primary }));
  expect(preview()).toBe(assistant.previewContent);
});

it("changing one baby reset does not include the sibling", async () => {
  const second = mockReset(7);
  renderComposer("service-feedback-link", second.caseId);
  await resetSecond();
  expect(api.getClientOverview).toHaveBeenCalledWith(20, second.caseId);
  await waitFor(() => expect(api.resetLink.mock.calls).toEqual([[11, {
    employeeId: 31, members: [{ caseId: second.caseId, assignmentVersion: 7 }],
  }]]));
  expect(await screen.findByRole("textbox", { name: "제공기록지 링크" })).toHaveValue(second.serviceRecordUrl);
  expect(api.sendLink).not.toHaveBeenCalled();
});

it("receipt mode keeps its original preparation and preview", async () => {
  jest.mocked(useSystemTemplate).mockReturnValue({ data: { content: "{{name}}|{{phone}}|{{receiptUrl}}" } } as never);
  const receipt = {
    clientId: 20, clientName: "테스트 산모", recipientPhone: "01055556666", documentId: "doc-receipt",
    receiptUrl: "https://example.test/receipt/receipt", expiresAt: expiry,
  };
  jest.mocked(eformsignApi.prepareReceiptLink).mockResolvedValue(receipt);
  renderComposer("receipt-link");
  fireEvent.click(screen.getByRole("button", { name: "산모 선택" }));
  await waitFor(() => expect(preview()).toBe(`테스트 산모|01055556666|${receipt.receiptUrl}`));
  expect(eformsignApi.prepareReceiptLink).toHaveBeenCalledWith(20);
  expect(api.getClientOverview).not.toHaveBeenCalled();
  expect(api.prepareLink).not.toHaveBeenCalled();
});

it("a selected record uses the registered phone while generic composition stays editable", async () => {
  api.prepareLink.mockResolvedValue({ data: prepared(31, [0, 1]) } as never);
  renderComposer();
  const phone = () => screen.getByRole("textbox", { name: /관리사님 전화번호/ });
  expect(phone()).toBeEnabled();
  fireEvent.change(phone(), { target: { value: "01099998888" } });
  expect(phone()).toHaveValue("010-9999-8888");
  expect(api.prepareLink).not.toHaveBeenCalled();
  select();
  await waitFor(() => expect(phone()).toBeDisabled());
  expect(phone()).toHaveValue("010-1111-2222");
  fireEvent.click(screen.getByRole("button", { name: "관리사 수동 입력" }));
  expect(phone()).toBeEnabled();
  fireEvent.change(phone(), { target: { value: "01077778888" } });
  expect(phone()).toHaveValue("010-7777-8888");
  expect(send()).toBeDisabled();
});

it("a same-employee case version refresh discards old preparation and resets with its new version", async () => {
  const old = prepared(31, [0, 1], 7);
  api.prepareLink.mockResolvedValueOnce({ data: old } as never).mockReturnValue(new Promise(() => {}));
  const second = mockReset(9);
  const client = renderComposer("service-feedback-link", second.caseId);
  select();
  await waitFor(() => expect(preview()).toBe(old.previewContent));
  expect(send()).toBeEnabled();

  api.getClientOverview.mockResolvedValue({ data: overview(31, 9) } as never);
  await act(async () => { await client.invalidateQueries({ queryKey: serviceRecordKeys.clientOverview(20) }); });
  await waitFor(() => expect(api.prepareLink).toHaveBeenCalledTimes(2));
  expect(send()).toBeDisabled();
  expect(preview()).not.toContain(old.members[1].serviceRecordUrl);
  fireEvent.click(send());
  expect(api.sendLink).not.toHaveBeenCalled();

  await resetSecond();
  await waitFor(() => expect(api.resetLink.mock.calls).toEqual([[11, {
    employeeId: 31, members: [{ caseId: second.caseId, assignmentVersion: 9 }],
  }]]));
  expect(api.sendLink).not.toHaveBeenCalled();
});

it("changing selected cases discards the old links before the next preparation finishes", async () => {
  const both = prepared(31, [0, 1]);
  const onlyFirst = prepared(31, [0]);
  let resolveFirst!: (value: { data: typeof onlyFirst }) => void;
  const onlyFirstRequest = new Promise<{ data: typeof onlyFirst }>((resolve) => { resolveFirst = resolve; });
  api.prepareLink.mockResolvedValueOnce({ data: both } as never).mockReturnValueOnce(onlyFirstRequest as never);
  renderComposer();
  select();
  await waitFor(() => expect(preview()).toBe(both.previewContent));

  fireEvent.click(screen.getByRole("checkbox", { name: "둘째 아기" }));
  expect(send()).toBeDisabled();
  expect(preview()).not.toContain(both.members[1].serviceRecordUrl);
  expect(api.prepareLink).toHaveBeenLastCalledWith(11, { employeeId: 31, caseIds: [caseIds[0]], recipientPhone: "01011112222" });
  fireEvent.click(send());
  expect(api.sendLink).not.toHaveBeenCalled();

  await act(async () => resolveFirst({ data: onlyFirst }));
  expect(preview()).toBe(onlyFirst.previewContent);
  expect(send()).toBeEnabled();
});
