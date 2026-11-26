import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createProblemDetails } from "@babyjamjam/shared";
import { api } from "@/lib/api/client";
import type { Client, ClientFormData, UpdateClientDto } from "@/features/clients/types";
import { AUTH_USER_QUERY_KEY } from "@/lib/auth/query-keys";
import { REGISTRATION_BRANCH_HEADER, REGISTRATION_USER_HEADER } from "@/features/clients/api/registration-scope";
import { useBusinessDayCalendar, type RefreshForSaveResult } from "@/hooks/useBusinessDayCalendar";
import { employeeQueryKeys, type Employee } from "@/hooks/useEmployees";
import { fetchAuthUser, type AuthUser } from "@/hooks/useGetAuthUser";
import { DetailPanel } from "@/components/app/v3/DetailPanel";
import { SteppedWizardStepper } from "@/components/app/v3/SteppedWizardStepper";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { CLIENT_FORM_STEPPER_STEPS, ClientFormDialog, ClientFormPanel } from "../ClientFormDialog";

jest.mock("@/hooks/useBusinessDayCalendar");
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));

const providers = ["김봄", "박여름", "이하늘", "최가을", "한겨울"].map((name, index): Employee => ({
  id: 11 + index,
  name,
  phone: "",
  workArea: ["인천"],
  grade: "A",
  openToNextWork: true,
  registeredDate: "2026-01-01",
  status: "available",
}));
const roles = ["주 제공인력", "보조 제공인력 1", "보조 제공인력 2", "보조 제공인력 3"];
const year = 2026;
const firstBranch = "11111111-1111-4111-8111-111111111111";
const secondBranch = "22222222-2222-4222-8222-222222222222";
const originalUserId = "qa-user";
const authSessionChanges = [
  { change: "the authenticated branch changes", branchId: secondBranch, userId: originalUserId },
  { change: "the authenticated user changes", branchId: firstBranch, userId: "qa-other-user" },
].flatMap((change) => [
  { ...change, selection: "explicit" },
  { ...change, selection: "automatic" },
]);
const grades = ["A가1형", "B가1형", "B가2형", "C가1형", "C가2형", "D가1형", "D가2형"];
const baby1 = { babyId: "c3a70030-e4a1-4dc0-976f-7d483fb4c4f1", ordinal: 1 };
const baby2 = { babyId: "cd19b5cd-e4c9-4f04-81e8-ad0a065db5ad", ordinal: 3 };
const basicInfo = {
  name: "QA-등록 폼 고객",
  birthday: "1990-01-01",
  dueDate: "2026-10-20",
  phone: "01000006621",
  address: "인천광역시 서구",
};
const savedTwins: Client = {
  ...basicInfo,
  id: 523,
  birthDate: null,
  primaryEmployee: providers[0],
  secondaryEmployee: providers[1],
  type: "B가2형",
  duration: 10,
  fullPrice: "1000000",
  grant: "800000",
  actualPrice: "200000",
  startDate: "2026-08-03",
  endDate: "2026-08-14",
  careCenter: false,
  voucherClient: true,
  breastPump: false,
  serviceStatus: "active",
  bookingConfirmedAt: "2026-07-29",
  eDocId: null,
  hasSigned: false,
  documentStatus: null,
  fetalType: "TWINS",
  fetalConfirmation: "CONFIRMED",
  babyCount: 2,
  babies: [baby1, baby2],
  historicalMaxOrdinal: 4,
  providers: [{ slot: 0, employeeId: 11 }, { slot: 1, employeeId: 12 }],
  babyAssignments: [{ ...baby1, providerSlot: 0 }, { ...baby2, providerSlot: 0 }],
  allocationVersion: "fixture-version-1",
  voucherIssuanceYear: year,
};

type Surface = "panel" | "dialog";
function FormFixture({
  surface = "panel", client, prefill = basicInfo, initialStep = 0, onSuccess,
}: {
  surface?: Surface;
  client?: Client;
  prefill?: Partial<ClientFormData>;
  initialStep?: number;
  onSuccess?: (client: Client) => void;
}) {
  const [step, setStep] = useState(initialStep);
  const [open, setOpen] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const close = () => setOpen(false);
  const props = { client, prefill, open, onClose: close, onSuccess };
  return surface === "dialog" ? <ClientFormDialog {...props} /> : (
    <>
      <ClientFormPanel {...props} activeStep={step} onActiveStepChange={setStep} onDirtyChange={setDirty}
        onBeforeClose={() => {
          if (dirty) setConfirmDiscard(true);
          return !dirty;
        }}
        renderLayout={({ content, footer }) => (
          <DetailPanel data-component="desktop_clients_fixture_detail-panel"
            title={client ? "고객 수정" : "고객 등록"}
            footer={footer} stepper={<SteppedWizardStepper steps={CLIENT_FORM_STEPPER_STEPS} currentStep={step} />}>
            {content}
          </DetailPanel>
        )}
      />
      <TwoButtonModal open={confirmDiscard} onOpenChange={setConfirmDiscard}
        title="작성 중인 고객 정보를 버리시겠습니까?" description="고객 폼을 닫습니다."
        approvalLabel="버리기" onApprove={() => { setConfirmDiscard(false); close(); }} />
    </>
  );
}

const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const selectBranch = (branchId: string) => {
  document.cookie = `selected_branch_id=${branchId}; path=/`;
  window.dispatchEvent(new Event("focus"));
};
const clearBranchSelection = () => { document.cookie = "selected_branch_id=; max-age=0; path=/"; };
const next = () => click("다음");
const previous = () => click("이전");
const select = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const fetusSelect = () => screen.getByRole("combobox", { name: "태아 유형" });
const ownerSelect = (row: string) => screen.getByRole("combobox", { name: row + " 담당자" });

async function selectProvider(slot: number, employee: Employee) {
  const trigger = screen.getByRole("combobox", { name: roles[slot] });
  const clear = within(trigger).queryByRole("button", { name: "제공인력 선택 해제" });
  if (clear) fireEvent.click(clear);
  fireEvent.click(trigger);
  const search = await screen.findByRole("combobox", { name: roles[slot] + " 검색" });
  fireEvent.change(search, { target: { value: employee.name } });
  const option = await screen.findByRole("option", { name: new RegExp(employee.name) });
  fireEvent.click(option);
  await waitFor(() => expect(trigger).toHaveTextContent(employee.name));
}

function expectInactiveSlots(capacity: number) {
  for (const label of roles.slice(capacity)) {
    const box = screen.getByRole("textbox", { name: label });
    expect(box).toBeDisabled();
    expect(box).toHaveValue("");
    expect(box).not.toHaveAttribute("placeholder");
  }
  for (const label of roles.slice(0, capacity)) {
    expect(screen.getByRole("combobox", { name: label })).toBeEnabled();
  }
}

describe("desktop client service-record allocation", () => {
  let queries: QueryClient;
  let currentClient: Client;
  let retiredSetting: boolean | undefined;
  const calendarHook = jest.mocked(useBusinessDayCalendar);
  const defaultCalendar = calendarHook.getMockImplementation()!;
  const get = jest.mocked(api.get);
  const post = jest.mocked(api.post);
  const patch = jest.mocked(api.patch);

  beforeAll(() => {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    HTMLElement.prototype.scrollTo = jest.fn();
    HTMLElement.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    selectBranch(firstBranch);
    retiredSetting = undefined;
    queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    queries.setQueryDefaults(AUTH_USER_QUERY_KEY, { gcTime: Infinity });
    alignAuth(firstBranch);
    queries.setQueryData(employeeQueryKeys.lists(), providers);
    currentClient = savedTwins;
    get.mockReset().mockImplementation(async (url, config) => {
      if (url === "/clients/baby-record-capability" && retiredSetting === false) {
        return { data: { enabled: retiredSetting } };
      }
      if (url === "/employees") return { data: providers };
      if (url === "/clients/check-phone") return { data: { exists: false } };
      if (url === "/area-templates/available-areas") return { data: [{ id: "Incheon", koreanName: "인천", name: "Incheon" }] };
      if (url === "/out-of-pocket-price-infos") return { data: [] };
      if (url === "/voucher-price-infos/years") return { data: [year] };
      if (url === "/voucher-price-infos/type") {
        const { type, year: requestedYear } = (config?.params ?? {}) as { type?: string; year?: number };
        return { data: requestedYear === year && type && grades.includes(type) ? [{
          id: grades.indexOf(type) + 1, type, duration: "10",
          fullPrice: "1000000", grant: "800000", actualPrice: "200000",
        }] : [] };
      }
      if (url === "/clients/523") return { data: currentClient };
      if (url === "/admin/service-records/client/523") return {
        data: { record: { id: "existing-case", startDate: savedTwins.startDate, sessions: [{ sessionIndex: 1 }] }, assignments: [] },
      };
      throw new Error("Unexpected fixture GET " + url);
    });
    post.mockReset().mockResolvedValue({ data: savedTwins });
    patch.mockReset().mockResolvedValue({ data: savedTwins });
  });

  afterEach(() => {
    calendarHook.mockImplementation(defaultCalendar);
    queries.clear();
    clearBranchSelection();
  });

  function alignAuth(branchId: string, userId = originalUserId) {
    queries.setQueryData(AUTH_USER_QUERY_KEY, { id: userId, name: "QA", branchId, branchRole: "manager" });
  }

  function selectScopedBranch(branchId: string) {
    selectBranch(branchId);
    alignAuth(branchId);
  }

  async function open(options: Parameters<typeof FormFixture>[0] = {}) {
    const view = render(<QueryClientProvider client={queries}><FormFixture {...options} /></QueryClientProvider>);
    await act(async () => {});
    if (!options.client) await screen.findByText("등록 가능한 번호입니다.");
    return view;
  }

  async function chooseGrade(type: string, surface: Surface = "panel") {
    if (surface === "panel") {
      await waitFor(() => expect(screen.getByRole("button", { name: "다음" })).toBeEnabled());
      next();
    }
    fireEvent.click(screen.getByRole("tab", { name: "바우처 고객" }));
    select("바우처 유형", type);
    await within(fetusSelect()).findByRole("option", { name: type.startsWith("A") ? "단태아" : /중증/ });
  }

  async function openSingletonRegistrationAtSave() {
    const view = await open();
    await chooseGrade("A가1형");
    next();
    next();
    return { view, submit: screen.getByRole("button", { name: "생성" }) };
  }

  it("renders dialog sections in the same order as the panel steps", async () => {
    await open({ surface: "dialog" });

    const headings = within(screen.getByRole("dialog")).getAllByRole("heading", {
      name: /^(기본 정보|서비스 정보|담당 제공인력|계약 정보)$/,
    });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "기본 정보", "서비스 정보", "담당 제공인력", "계약 정보",
    ]);
  });

  it.each<Surface>(["panel", "dialog"])("registers B② severe singleton with secondary ownership through the %s", async (surface) => {
    await open({ surface });
    await chooseGrade("B가2형", surface);
    select("태아 유형", "SEVERE_SINGLETON");
    if (surface === "panel") next();
    expectInactiveSlots(2);
    expect(ownerSelect("아기 기록지")).toBeDisabled();
    expect(ownerSelect("아기 기록지")).toHaveValue("");
    await selectProvider(0, providers[0]);
    await selectProvider(1, providers[1]);
    expect(within(ownerSelect("아기 기록지")).getByRole("option", { name: "보조 제공인력 1 · 박여름" })).toHaveValue("1");
    select("아기 기록지 담당자", "1");
    expect(ownerSelect("아기 기록지")).toHaveValue("1");
    expect(screen.queryByText("둘째 기록지")).not.toBeInTheDocument();
    if (surface === "panel") {
      expect(screen.queryByRole("switch", { name: "메시지 자동 전송" })).not.toBeInTheDocument();
      next();
    }
    const automationSwitch = screen.getByRole("switch", { name: "메시지 자동 전송" });
    expect(automationSwitch).toBeChecked();
    fireEvent.click(automationSwitch);
    await waitFor(() => expect(screen.getByRole("button", { name: "생성" })).toBeEnabled());
    click("생성");
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const body = post.mock.calls[0][1];
    expect(body).toMatchObject({
      type: "B가2형", voucherIssuanceYear: 2026, fetalType: "SEVERE_SINGLETON", babyCount: 1,
      applyMessageAutomation: false, smsAutomationEnabled: false,
      providers: [{ slot: 0, employeeId: 11 }, { slot: 1, employeeId: 12 }],
      babyAssignments: [{ ordinal: 1, providerSlot: 1 }],
    });
    expect(body).not.toHaveProperty("primaryEmployeeId");
    expect(body).not.toHaveProperty("secondaryEmployeeId");
  });

  it("shows the approved steps and preserves a B① twin draft with one provider through back, next and cancelled discard", async () => {
    await open();
    const stepLabels = screen.getAllByText(/^(이용자|바우처|제공인력|계약)\s+정보$/);
    expect(stepLabels.map((label) => label.textContent?.replace(/\s+/g, " "))).toEqual([
      "이용자 정보", "바우처 정보", "제공인력 정보", "계약 정보",
    ]);
    await chooseGrade("B가1형");
    next();
    expect(fetusSelect()).toHaveAttribute("aria-invalid", "true");
    select("태아 유형", "TWINS");
    next();
    expectInactiveSlots(1);
    await selectProvider(0, providers[0]);
    expect(screen.getAllByText("주 제공인력 · 김봄")).toHaveLength(2);
    previous();
    previous();
    click("취소");
    const discard = screen.getByRole("dialog", { name: "작성 중인 고객 정보를 버리시겠습니까?" });
    fireEvent.click(within(discard).getByRole("button", { name: "취소" }));
    next();
    expect(fetusSelect()).toHaveValue("TWINS");
    next();
    expect(screen.getAllByText("주 제공인력 · 김봄")).toHaveLength(2);
    next();
    click("생성");
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toMatchObject({
      providers: [{ slot: 0, employeeId: 11 }],
      babyAssignments: [{ ordinal: 1, providerSlot: 0 }, { ordinal: 2, providerSlot: 0 }],
    });
  });

  it.each([
    ["A가1형", ["단태아"], "SINGLETON", 1, true],
    ["B가1형", ["중증 단태아", "쌍생아"], "SEVERE_SINGLETON", 1, true],
    ["C가1형", ["중증 쌍태아", "삼태아"], "SEVERE_TWINS", 2, true],
    ["C가2형", ["중증 쌍태아", "삼태아"], "TRIPLETS", 3, true],
  ] as const)("uses the shared fetal choices and staffing capacity for %s", async (code, labels, value, capacity, showsOwners) => {
    await open();
    await chooseGrade(code);
    expect(within(fetusSelect()).getAllByRole("option").filter((option) => (option as HTMLOptionElement).value)
      .map((option) => option.textContent)).toEqual(labels);
    if (code.startsWith("A")) {
      expect(fetusSelect()).toBeDisabled();
      expect(fetusSelect()).toHaveValue("SINGLETON");
    } else {
      select("태아 유형", value);
    }
    next();
    expectInactiveSlots(capacity);
    expect(screen.queryByRole("heading", { name: "서비스 제공기록지 담당" }) !== null).toBe(showsOwners);
  });

  it("accepts five D② babies, rejects an incomplete count, and excludes duplicate employees", async () => {
    await open();
    await chooseGrade("D가2형");
    expect(within(fetusSelect()).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["태아 유형 선택", "중증 삼태아 이상", "사태아 이상"]);
    select("태아 유형", "SEVERE_TRIPLETS_PLUS");
    expect(screen.getByRole("spinbutton", { name: "실제 아기 수" })).toHaveAttribute("min", "3");
    select("태아 유형", "QUADRUPLETS_PLUS");
    const count = screen.getByRole("spinbutton", { name: "실제 아기 수" });
    expect(count).toHaveAttribute("min", "4");
    next();
    expect(count).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(count, { target: { value: "5" } });
    next();
    expectInactiveSlots(4);
    await selectProvider(0, providers[0]);
    fireEvent.click(screen.getByRole("combobox", { name: roles[1] }));
    fireEvent.change(await screen.findByRole("combobox", { name: roles[1] + " 검색" }), { target: { value: "김봄" } });
    expect(screen.queryByRole("option", { name: /김봄/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: roles[1] }));
    for (const slot of [1, 2, 3]) await selectProvider(slot, providers[slot]);
    expect(screen.queryByRole("combobox", { name: "첫째 기록지 담당자" })).not.toBeInTheDocument();
    expect(ownerSelect("넷째 기록지")).toHaveValue("3");
    expect(ownerSelect("다섯째 기록지")).toHaveValue("0");
    select("다섯째 기록지 담당자", "2");
    next();
    click("생성");
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toMatchObject({
      babyCount: 5,
      providers: providers.slice(0, 4).map(({ id }, slot) => ({ slot, employeeId: id })),
      babyAssignments: [0, 1, 2, 3, 2].map((providerSlot, index) => ({ ordinal: index + 1, providerSlot })),
    });
  });

  it("opens a booked twin case, confirms corrected dates, and saves both changes in exactly one PATCH", async () => {
    patch.mockImplementation(async (_url, body) => {
      const dto = body as UpdateClientDto;
      currentClient = {
        ...savedTwins,
        startDate: dto.startDate!,
        endDate: dto.endDate!,
        providers: dto.providers,
        babyAssignments: savedTwins.babies?.map((baby) => ({
          ...baby,
          providerSlot: dto.providers === undefined ? null
            : dto.babyAssignments.find(({ babyId }) => babyId === baby.babyId)?.providerSlot ?? null,
        })),
        allocationVersion: "fixture-version-2",
      };
      return { data: currentClient };
    });
    const before = (await api.get<Client>("/clients/523")).data;
    const onSuccess = jest.fn();
    const view = await open({ client: before, initialStep: 2, onSuccess });
    await selectProvider(0, providers[4]);
    expect(ownerSelect("둘째 기록지")).toHaveValue("0");
    select("둘째 기록지 담당자", "1");
    next();
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-08-04" } });
    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2026-08-18"));
    click("저장");
    const started = await screen.findByRole("dialog", { name: "서비스 시작 후 변경" });
    expect(patch).not.toHaveBeenCalled();
    fireEvent.click(within(started).getByRole("button", { name: "진행" }));
    const records = await screen.findByRole("dialog", { name: "제공기록지 회차 처리" });
    fireEvent.click(within(records).getByRole("button", { name: "모두 옮기기" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("/clients/523", {
      startDate: "2026-08-04", endDate: "2026-08-18", duration: 10, expectedEndDate: "2026-08-14",
      startDateChangeMode: "MOVE", expectedAllocationVersion: "fixture-version-1",
      fetalType: "TWINS", babyCount: 2, voucherIssuanceYear: 2026,
      providers: [{ slot: 0, employeeId: 15 }, { slot: 1, employeeId: 12 }],
      babyAssignments: [{ babyId: baby1.babyId, providerSlot: 0 }, { babyId: baby2.babyId, providerSlot: 1 }],
    });
    view.unmount();
    const after = (await api.get<Client>("/clients/523")).data;
    await open({ client: after, initialStep: 2 });
    expect(ownerSelect("둘째 기록지")).toHaveValue("1");
    await waitFor(() => expect(screen.getByRole("combobox", { name: roles[0] })).toHaveTextContent("한겨울"));
  });

  it("retains explicit choices until valid and maps field errors to the correct submitted row and step", async () => {
    const client: Client = {
      ...savedTwins,
      providers: [{ slot: 0, employeeId: 11 }, { slot: 1, employeeId: 12 }],
      babyAssignments: [{ ...baby1, providerSlot: 0 }, { ...baby2, providerSlot: 1 }],
    };
    const invalid = (pointer: string) => ({
      response: { status: 400, data: createProblemDetails({
        code: "VALIDATION_FAILED", status: 400, requestId: "req-fixture-allocation",
        errors: [{ pointer, code: "INVALID_VALUE", detail: "ignored" }],
      }) },
    });
    patch.mockRejectedValueOnce(invalid("/babyAssignments/1/providerSlot"))
      .mockRejectedValueOnce(invalid("/fetalType"));
    await open({ client, initialStep: 2 });
    fireEvent.click(within(screen.getByRole("combobox", { name: roles[1] }))
      .getByRole("button", { name: "제공인력 선택 해제" }));
    expect(await screen.findByText("담당 제공인력을 다시 선택해 주세요.")).toBeVisible();
    next();
    expect(ownerSelect("둘째 기록지")).toHaveValue("");
    select("둘째 기록지 담당자", "0");
    next();
    click("저장");
    expect(await screen.findByRole("combobox", { name: "둘째 기록지 담당자" })).toHaveAttribute("aria-invalid", "true");
    expect(ownerSelect("둘째 기록지")).toHaveValue("0");
    next();
    click("저장");
    expect(await screen.findByRole("combobox", { name: "태아 유형" })).toHaveAttribute("aria-invalid", "true");
    expect(fetusSelect()).toHaveValue("TWINS");
  });

  it("lets the first twin record replace the severe singleton's secondary owner with the primary owner", async () => {
    await open({
      client: {
        ...savedTwins,
        fetalType: "SEVERE_SINGLETON",
        babyCount: 1,
        babies: [baby1],
        babyAssignments: [{ ...baby1, providerSlot: 1 }],
      },
      initialStep: 1,
    });
    await within(fetusSelect()).findByRole("option", { name: "쌍생아" });
    select("태아 유형", "TWINS");
    next();

    const firstOwner = ownerSelect("첫째 기록지");
    expect(firstOwner).toBeEnabled();
    expect(firstOwner).toHaveValue("");
    expect(firstOwner).toHaveAccessibleDescription("담당 제공인력을 다시 선택해 주세요.");
    expect(within(firstOwner).queryByRole("option", { name: /박여름/ })).not.toBeInTheDocument();
    next();
    expect(firstOwner).toBeVisible();

    select("첫째 기록지 담당자", "0");
    expect(firstOwner).not.toBeInTheDocument();
    expect(screen.getByText("주 제공인력 · 김봄", { selector: "span" })).toBeVisible();
    next();
    click("저장");
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][1]).toMatchObject({
      fetalType: "TWINS",
      babyCount: 2,
      expectedAllocationVersion: "fixture-version-1",
      babyAssignments: [{ babyId: baby1.babyId, providerSlot: 0 }, { ordinal: 5, providerSlot: 1 }],
    });
  });

  it("keeps given baby IDs and adds the new child after the historical maximum when the grade changes", async () => {
    await open({ client: savedTwins, initialStep: 1 });
    await within(fetusSelect()).findByRole("option", { name: "쌍생아" });
    select("바우처 유형", "C가2형");
    await within(fetusSelect()).findByRole("option", { name: "삼태아" });
    expect(fetusSelect()).toHaveValue("");
    select("태아 유형", "TRIPLETS");
    next();
    expectInactiveSlots(3);
    await selectProvider(2, providers[2]);
    expect(ownerSelect("둘째 기록지")).toHaveValue("0");
    expect(ownerSelect("셋째 기록지")).toHaveValue("2");
    next();
    click("저장");
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][1]).toMatchObject({
      type: "C가2형", expectedAllocationVersion: "fixture-version-1",
      babyAssignments: [
        { babyId: baby1.babyId, providerSlot: 0 },
        { babyId: baby2.babyId, providerSlot: 0 },
        { ordinal: 5, providerSlot: 2 },
      ],
    });
  });

  it("asks before reducing saved children and displays an authored-removal conflict on the voucher step", async () => {
    patch.mockRejectedValueOnce({
      response: { status: 409, data: createProblemDetails({
        code: "REQUEST_CONFLICT", requestId: "req-authored-removal",
        errors: [{ pointer: "/babyCount", code: "INVALID_VALUE", detail: "ignored" }],
      }) },
    });
    await open({ client: savedTwins, initialStep: 1 });
    select("바우처 유형", "A가1형");
    await within(fetusSelect()).findByRole("option", { name: "단태아" });
    next();
    expectInactiveSlots(1);
    next();
    click("저장");
    const modal = await screen.findByRole("dialog", { name: "아기 수 변경 확인" });
    expect(patch).not.toHaveBeenCalled();
    fireEvent.click(within(modal).getByRole("button", { name: "확인" }));
    await waitFor(() => expect(fetusSelect()).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText("요청 ID: req-authored-removal")).toBeVisible();
    expect(patch.mock.calls[0][1]).toMatchObject({
      providers: [{ slot: 0, employeeId: 11 }],
      babyAssignments: [{ babyId: baby1.babyId, providerSlot: 0 }],
    });
  });

  it("sends one legacy PATCH containing only the changed address for a confirmed twin client", async () => {
    const onSuccess = jest.fn();
    await open({ client: savedTwins, onSuccess });
    const address = "인천광역시 동구";
    fireEvent.change(screen.getByLabelText(/^주소/), { target: { value: address } });
    next();
    await within(fetusSelect()).findByRole("option", { name: "쌍생아" });
    expect(fetusSelect()).toHaveValue("TWINS");
    next();
    next();
    click("저장");
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls).toStrictEqual([["/clients/523", { address }]]);
  });

  it("terminated household retains historical staff without sending an allocation edit", async () => {
    const primaryEmployee = { id: 31, name: "과거 주 제공인력" };
    const secondaryEmployee = { id: 32, name: "과거 보조 제공인력" };
    const babies = [baby1, baby2,
      { babyId: "9c97b596-1e5e-43f8-88ff-657b46bddb33", ordinal: 4 },
      { babyId: "c97cd694-2203-4aa8-86e8-dee52dd40666", ordinal: 5 },
    ];
    const address = "인천광역시 동구";
    await open({ client: {
      ...savedTwins, type: "D가2형", serviceStatus: "terminated", fetalType: "QUADRUPLETS_PLUS",
      babyCount: babies.length, babies, historicalMaxOrdinal: 5, primaryEmployee, secondaryEmployee, providers: [],
      babyAssignments: babies.map((baby) => ({ ...baby, providerSlot: null })),
    } });

    fireEvent.change(screen.getByLabelText(/^주소/), { target: { value: address } });
    next();
    await within(fetusSelect()).findByRole("option", { name: "사태아 이상" });
    next();
    expect(screen.getByRole("textbox", { name: roles[0] })).toHaveValue(primaryEmployee.name);
    expect(screen.getByRole("textbox", { name: roles[1] })).toHaveValue(secondaryEmployee.name);
    for (const label of roles.slice(2)) {
      const field = screen.getByRole("combobox", { name: label });
      expect(within(field).queryByRole("button", { name: "제공인력 선택 해제" })).not.toBeInTheDocument();
    }
    const owners = screen.getByRole("heading", { name: "서비스 제공기록지 담당" }).closest("section")!;
    expect(within(owners).getAllByText("미배정")).toHaveLength(babies.length);
    expect(within(owners).queryByRole("button", { name: "담당 변경" })).not.toBeInTheDocument();
    next();
    click("저장");

    await waitFor(() => expect(patch.mock.calls).toStrictEqual([["/clients/523", { address }]]));
  });

  it("active empty staff projection does not resurrect a historical employee", async () => {
    const address = "인천광역시 동구";
    await open({ surface: "dialog", client: {
      ...savedTwins, providers: [],
      babyAssignments: [{ ...baby1, providerSlot: null }, { ...baby2, providerSlot: null }],
    } });

    for (const [slot, employee] of providers.slice(0, 2).entries()) {
      const field = screen.getByRole("combobox", { name: roles[slot] });
      expect(field).not.toHaveTextContent(employee.name);
      expect(within(field).queryByRole("button", { name: "제공인력 선택 해제" })).not.toBeInTheDocument();
    }
    fireEvent.change(screen.getByLabelText(/^주소/), { target: { value: address } });
    click("저장");

    await waitFor(() => expect(patch.mock.calls).toStrictEqual([["/clients/523", { address }]]));
  });

  it("displays a historical secondary employee without enabling a disabled slot", async () => {
    await open({ surface: "dialog", client: {
      ...savedTwins, type: "B가1형", serviceStatus: "terminated", providers: [], babyAssignments: [],
    } });
    await within(fetusSelect()).findByRole("option", { name: "쌍생아" });

    const secondary = screen.getByRole("textbox", { name: roles[1] });
    expect(secondary).toBeDisabled();
    expect(secondary).toHaveValue(providers[1].name);
    for (const label of roles.slice(2)) {
      expect(screen.getByRole("textbox", { name: label })).toHaveValue("");
    }
  });

  it("uses the explicit provider projection for a terminated customer when it has current staff", async () => {
    await open({ surface: "dialog", client: {
      ...savedTwins, serviceStatus: "terminated", providers: [{ slot: 0, employeeId: providers[4].id }],
    } });

    expect(await screen.findByRole("combobox", { name: roles[0] })).toHaveTextContent(providers[4].name);
    expect(screen.getByRole("combobox", { name: roles[1] })).not.toHaveTextContent(providers[1].name);
  });

  it("keeps legacy B–D confirmation pending and sends only an unrelated partial edit", async () => {
    await open({ client: {
      ...savedTwins, type: "D가2형", fetalConfirmation: "UNCONFIRMED", fetalType: null,
      babyCount: null, babies: [], babyAssignments: [], providers: undefined, historicalMaxOrdinal: 0,
    } });
    fireEvent.change(screen.getByLabelText(/^주소/), { target: { value: "인천광역시 동구" } });
    next();
    await within(fetusSelect()).findByRole("option", { name: "사태아 이상" });
    expect(fetusSelect()).toHaveValue("");
    next();
    await waitFor(() => expect(screen.getByRole("combobox", { name: roles[0] })).toHaveTextContent(providers[0].name));
    expect(screen.getByRole("combobox", { name: roles[1] })).toHaveTextContent(providers[1].name);
    expect(screen.queryByRole("heading", { name: "서비스 제공기록지 담당" })).not.toBeInTheDocument();
    next();
    click("저장");
    await waitFor(() => expect(patch).toHaveBeenCalledWith("/clients/523", { address: "인천광역시 동구" }));
  });

  it("keeps an unconnected regional registration on the existing no-voucher payload", async () => {
    await open();
    await screen.findByRole("option", { name: "인천" });
    select("관할 지역", "Incheon");
    await waitFor(() => expect(screen.getByRole("button", { name: "다음" })).toBeEnabled());
    next();
    expect(screen.queryByLabelText("태아 유형")).not.toBeInTheDocument();
    next();
    expectInactiveSlots(2);
    next();
    click("생성");
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const body = post.mock.calls[0][1];
    expect(body).toMatchObject({ voucherClient: false, type: null, areaId: "Incheon", primaryEmployeeId: null });
    expect(body).not.toHaveProperty("providers");
  });

  it.each([false, undefined])("registers A singleton with the full payload when the old setting is %s", async (setting) => {
    retiredSetting = setting;
    selectScopedBranch(secondBranch);
    await open();
    await chooseGrade("A가1형");
    expect(fetusSelect()).toBeDisabled();
    expect(fetusSelect()).toHaveValue("SINGLETON");
    next();
    expectInactiveSlots(1);
    const owners = screen.getByRole("heading", { name: "서비스 제공기록지 담당" }).closest("section")!;
    expect(within(owners).getByText("미배정")).toBeVisible();
    await selectProvider(0, providers[0]);
    expect(within(owners).getByText("주 제공인력 · 김봄")).toBeVisible();
    next();
    click("생성");
    await waitFor(() => expect(post).toHaveBeenCalledWith("/clients", expect.objectContaining({
      voucherClient: true, type: "A가1형", fetalType: "SINGLETON", babyCount: 1, voucherIssuanceYear: year,
      providers: [{ slot: 0, employeeId: 11 }],
      babyAssignments: [{ ordinal: 1, providerSlot: 0 }],
    })));
    expect(get.mock.calls.map(([url]) => url)).not.toContain("/clients/baby-record-capability");
  });

  it.each([
    ["A가1형", "SINGLETON", 1],
    ["B가1형", "SEVERE_SINGLETON", 1],
    ["C가1형", "SEVERE_TWINS", 2],
    ["D가1형", "SEVERE_TRIPLETS_PLUS", 3],
  ] as const)("registers %s in an authenticated branch without selection cookies", async (grade, fetalType, count) => {
    clearBranchSelection();
    queries.setQueryData(employeeQueryKeys.lists(), [{ ...providers[0], name: "다른 지점 제공인력" }]);
    await open();
    await chooseGrade(grade);
    if (fetalType !== "SINGLETON") select("태아 유형", fetalType);
    if (fetalType === "SEVERE_TRIPLETS_PLUS") {
      fireEvent.change(screen.getByRole("spinbutton", { name: "실제 아기 수" }), { target: { value: String(count) } });
    }
    next();
    const owners = screen.getByRole("heading", { name: "서비스 제공기록지 담당" }).closest("section")!;
    await selectProvider(0, providers[0]);
    expect(within(owners).getAllByText("주 제공인력 · 김봄")).toHaveLength(count);
    next();
    await waitFor(() => expect(screen.getByRole("button", { name: "생성" })).toBeEnabled());
    click("생성");
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const headers = { [REGISTRATION_BRANCH_HEADER]: firstBranch, [REGISTRATION_USER_HEADER]: originalUserId };
    expect(get).toHaveBeenCalledWith("/employees", { headers });
    expect(get.mock.calls.filter(([url]) => url === "/employees").every(([, config]) => config?.headers != null)).toBe(true);
    expect(post).toHaveBeenCalledWith("/clients", expect.objectContaining({
      type: grade, fetalType, babyCount: count,
      providers: [{ slot: 0, employeeId: 11 }],
      babyAssignments: Array.from({ length: count }, (_, index) => ({ ordinal: index + 1, providerSlot: 0 })),
    }), { headers });
    expect(document.cookie).not.toMatch(/selected_(branch|organization)_id/);
  });

  it("binds the open registration when automatic branch authority first resolves", async () => {
    clearBranchSelection();
    queries.removeQueries({ queryKey: AUTH_USER_QUERY_KEY });
    await open();
    next();
    fireEvent.click(screen.getByRole("tab", { name: "바우처 고객" }));
    select("바우처 유형", "A가1형");
    expect(screen.queryByLabelText("태아 유형")).not.toBeInTheDocument();

    await act(async () => alignAuth(firstBranch));
    await within(fetusSelect()).findByRole("option", { name: "단태아" });
    expect(fetusSelect()).toHaveValue("SINGLETON");
    next();
    await selectProvider(0, providers[0]);
    next();
    click("생성");
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });

  it("hides previously selectable scoped providers after a denied refresh and recovers on success", async () => {
    clearBranchSelection();
    render(<QueryClientProvider client={queries}><FormFixture initialStep={2} /></QueryClientProvider>);

    const trigger = screen.getByRole("combobox", { name: roles[0] });
    fireEvent.click(trigger);
    const search = await screen.findByRole("combobox", { name: roles[0] + " 검색" });
    fireEvent.change(search, { target: { value: providers[0].name } });
    const oldOption = { name: new RegExp(providers[0].name) };
    expect(await screen.findByRole("option", oldOption)).toBeVisible();

    const defaultGet = get.getMockImplementation()!;
    const refresh = jest.fn().mockRejectedValueOnce({
      response: { status: 403, data: { code: "ACCESS_DENIED" } },
    });
    get.mockImplementation((url, config) => url === "/employees" ? refresh(config) : defaultGet(url, config));
    await act(async () => { await queries.invalidateQueries({ queryKey: employeeQueryKeys.lists() }); });
    expect(refresh).toHaveBeenCalledWith({
      headers: { [REGISTRATION_BRANCH_HEADER]: firstBranch, [REGISTRATION_USER_HEADER]: originalUserId },
    });
    await waitFor(() => expect(screen.queryByRole("option", oldOption)).not.toBeInTheDocument());
    expect(search).toBeVisible();

    const recoveredProvider = { ...providers[0], id: 31, name: "김봄 신규" };
    refresh.mockResolvedValue({ data: [recoveredProvider] });
    await act(async () => { await queries.invalidateQueries({ queryKey: employeeQueryKeys.lists() }); });
    fireEvent.click(await screen.findByRole("option", { name: /김봄 신규/ }));
    expect(trigger).toHaveTextContent(recoveredProvider.name);
  });

  it("waits for cookieless branch authority before mounting provider search", async () => {
    clearBranchSelection();
    queries.removeQueries({ queryKey: AUTH_USER_QUERY_KEY });
    queries.setQueryData(employeeQueryKeys.lists(), [{ ...providers[0], name: "다른 지점 제공인력" }]);
    const defaultGet = get.getMockImplementation()!;
    let resolveAuth!: (user: AuthUser) => void;
    get.mockImplementation((url, config) => url === "/auth/me"
      ? new Promise((resolve) => { resolveAuth = (user) => resolve({ data: user }); })
      : defaultGet(url, config));
    const authRequest = queries.fetchQuery({ queryKey: AUTH_USER_QUERY_KEY, queryFn: fetchAuthUser });

    render(<QueryClientProvider client={queries}><FormFixture initialStep={2} /></QueryClientProvider>);
    await act(async () => {});
    expect(document.cookie).not.toMatch(/selected_(branch|organization)_id/);
    expect(get).toHaveBeenCalledWith("/auth/me");
    expect(get.mock.calls.map(([url]) => url)).not.toContain("/employees");
    expect(screen.queryByRole("combobox", { name: roles[0] })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: roles[0] })).toBeDisabled();

    await act(async () => {
      resolveAuth({ id: originalUserId, name: "QA", branchId: firstBranch, branchRole: "manager" });
      await authRequest;
    });
    await selectProvider(0, providers[0]);
    const headers = { [REGISTRATION_BRANCH_HEADER]: firstBranch, [REGISTRATION_USER_HEADER]: originalUserId };
    const employeeRequests = get.mock.calls.filter(([url]) => url === "/employees");
    expect(employeeRequests).not.toHaveLength(0);
    for (const request of employeeRequests) {
      expect(request).toEqual(["/employees", { headers }]);
    }
  });

  it.each<Surface>(["panel", "dialog"])("saves a voucher consultation without a type in the %s", async (surface) => {
    await open({ surface });
    if (surface === "panel") {
      await screen.findByText("등록 가능한 번호입니다.");
      next();
    }
    fireEvent.click(screen.getByRole("tab", { name: "바우처 고객" }));
    expect(screen.getByLabelText("바우처 유형")).toHaveValue("");
    if (surface === "panel") {
      next();
      expect(screen.getByRole("combobox", { name: roles[0] })).toBeVisible();
      next();
    }

    await waitFor(() => expect(screen.getByRole("button", { name: "생성" })).toBeEnabled());
    click("생성");
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/clients", expect.objectContaining({
      voucherClient: true, type: null, primaryEmployeeId: null, secondaryEmployeeId: null,
    }));
    const body = post.mock.calls[0][1];
    for (const key of ["fetalType", "babyCount", "providers", "babyAssignments"]) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it.each<Surface>(["panel", "dialog"])("explains why the %s cannot save when branches differ at open", async (surface) => {
    selectBranch(secondBranch);
    await open({ surface });
    if (surface === "panel") next();
    fireEvent.click(screen.getByRole("tab", { name: "바우처 고객" }));
    select("바우처 유형", "A가1형");
    if (surface === "panel") {
      next();
      next();
    }
    const submit = screen.getByRole("button", { name: "생성" });
    expect(submit).toBeDisabled();
    expect(screen.getByText("지점을 선택한 후 양식을 다시 열어 주세요.")).toHaveAttribute("role", "status");
    fireEvent.click(submit);
    expect(post).not.toHaveBeenCalled();
  });

  it.each(authSessionChanges)("requires reopening when $change during $selection selection", async ({ branchId, userId, selection }) => {
    if (selection === "automatic") clearBranchSelection();
    const { submit } = await openSingletonRegistrationAtSave();
    expect(submit).toBeEnabled();

    await act(async () => alignAuth(branchId, userId));
    expect(submit).toBeDisabled();
    const reopenMessage = "선택한 지점이 바뀌었어요. 현재 지점에서 저장하려면 이 창을 닫고 다시 열어 주세요.";
    expect(screen.getByText(reopenMessage)).toHaveAttribute("role", "status");

    await act(async () => alignAuth(firstBranch));
    expect(submit).toBeDisabled();
    expect(screen.getByText(reopenMessage)).toBeVisible();
    fireEvent.click(submit);
    expect(post).not.toHaveBeenCalled();
  });

  it.each(authSessionChanges)("refuses a pending $selection registration when $change before the form observes it", async ({ branchId, userId, selection }) => {
    if (selection === "automatic") clearBranchSelection();
    const calendar = defaultCalendar().calendar;
    let finishRefresh!: (result: RefreshForSaveResult) => void;
    const refreshForSave = jest.fn(() => new Promise<RefreshForSaveResult>((resolve) => { finishRefresh = resolve; }));
    calendarHook.mockReturnValue({ ...defaultCalendar(), refreshForSave });
    const { submit } = await openSingletonRegistrationAtSave();
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(refreshForSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      // Keep the new authority in the cache while the form still has its previous render.
      const notify = jest.spyOn(queries.getQueryCache(), "notify").mockImplementationOnce(() => {});
      try {
        alignAuth(branchId, userId);
      } finally {
        notify.mockRestore();
      }
      finishRefresh({ ok: true, changed: false, calendar });
    });

    expect(post).not.toHaveBeenCalled();
  });

  it("discards a pending automatic registration when an explicit branch choice takes over", async () => {
    const calendar = defaultCalendar().calendar;
    let finishRefresh!: (result: RefreshForSaveResult) => void;
    const refreshForSave = jest.fn(() => new Promise<RefreshForSaveResult>((resolve) => { finishRefresh = resolve; }));
    calendarHook.mockReturnValue({ ...defaultCalendar(), refreshForSave });
    clearBranchSelection();
    const { submit } = await openSingletonRegistrationAtSave();
    fireEvent.click(submit);
    expect(refreshForSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      selectBranch(firstBranch);
      finishRefresh({ ok: true, changed: false, calendar });
    });
    expect(submit).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it.each(["different branch", "missing branch", "invalidated auth", "different customer"] as const)(
    "discards a save waiting on the calendar after %s", async (change) => {
      let finishRefresh!: (result: RefreshForSaveResult) => void;
      const refreshForSave = jest.fn(() => new Promise<RefreshForSaveResult>((resolve) => { finishRefresh = resolve; }));
      const calendar = defaultCalendar().calendar;
      calendarHook.mockReturnValue({ ...defaultCalendar(), refreshForSave });
      // Exercise normalization of an encoded selected branch against the auth ID.
      selectBranch(encodeURIComponent(` ${firstBranch} `));
      const { view, submit } = await openSingletonRegistrationAtSave();
      expect(submit).toBeEnabled();
      fireEvent.click(submit);
      expect(refreshForSave).toHaveBeenCalledTimes(1);

      await act(async () => {
        if (change === "different branch") selectScopedBranch(secondBranch);
        if (change === "missing branch") selectBranch("");
        if (change === "invalidated auth") await queries.invalidateQueries({ queryKey: AUTH_USER_QUERY_KEY });
        if (change === "different customer") {
          view.rerender(<QueryClientProvider client={queries}><FormFixture client={savedTwins} /></QueryClientProvider>);
        }
      });
      await act(async () => finishRefresh({ ok: true, changed: false, calendar }));
      expect(post).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
      if (change === "different branch" || change === "missing branch") {
        await act(async () => selectScopedBranch(firstBranch));
        expect(submit).toBeDisabled();
      }
    },
  );

  async function openShrinkConfirmation() {
    await open({
      client: { ...savedTwins, babyAssignments: [{ ...baby1, providerSlot: 0 }, { ...baby2, providerSlot: 1 }] },
      initialStep: 1,
    });
    select("바우처 유형", "A가1형");
    await within(fetusSelect()).findByRole("option", { name: "단태아" });
    next();
    next();
    click("저장");
    return screen.findByRole("dialog", { name: "아기 수 변경 확인" });
  }

  it("shows the current affected baby ranks and their saved staff before reducing a household", async () => {
    const modal = await openShrinkConfirmation();
    const removed = within(modal).getAllByRole("listitem");
    expect(removed).toHaveLength(1);
    expect(removed[0]).toHaveTextContent("둘째");
    expect(removed[0]).toHaveTextContent("박여름");
    expect(modal).not.toHaveTextContent(/첫째|셋째|김봄/);
    expect(patch).not.toHaveBeenCalled();
  });

  it("canceling the retirement confirmation sends no update", async () => {
    const modal = await openShrinkConfirmation();
    fireEvent.click(within(modal).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog", { name: "아기 수 변경 확인" })).not.toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
    click("저장");
    expect(await screen.findByRole("dialog", { name: "아기 수 변경 확인" })).toBeVisible();
    expect(patch).not.toHaveBeenCalled();
  });
});
