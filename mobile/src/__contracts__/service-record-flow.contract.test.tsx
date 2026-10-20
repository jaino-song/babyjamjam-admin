/**
 * Behavior contract for the public service-record (제공기록지) token page.
 *
 * Seam: the real page, with `global.fetch` answering the page's endpoints
 * (see service-record-flow.fixtures.ts). Nothing below the page is mocked
 * except the canvas signature pad, which jsdom cannot draw.
 *
 * These tests pin what the user can do and what reaches the server, not how
 * the controls are built: elements are found by role, accessible name, label
 * text or visible text, option selection is asserted through the request
 * payload or the review screen, never through a control's own selected state.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ServiceRecordPage from "@/app/(public)/service-record/[token]/page";
import { DAILY_ITEMS } from "@babyjamjam/service-record-ui";
import { FIELD_COPY } from "../../../packages/service-record-ui/src/field-messages";

import {
    NOW,
    PLANNED_DATES,
    SAVED_HEADER,
    SERVER_NAMES,
    SUBMITTED_ANSWERS,
    TOKEN,
    installApi,
    makeContext,
    makeSession,
    makeSubmittedFirstSession,
    type ApiScript,
} from "./service-record-flow.fixtures";

jest.mock("next/navigation", () => ({ useParams: () => ({ token: "contract-token" }) }));
jest.mock("@/hooks/useTokenBusinessDayCalendar", () => ({
    useTokenBusinessDayCalendar: () => ({
        calendar: { isBusinessDay: () => true, diffBusinessDays: () => 5 },
        ready: true, error: null, retry: jest.fn(),
    }),
}));
// jsdom has no canvas: a stand-in that "signs" with a fixed data URI.
jest.mock("@/components/app/service-record/SignaturePad", () => ({
    SignaturePad: ({ onChange }: { onChange: (dataUri: string | null) => void }) => (
        <button type="button" onClick={() => onChange("data:image/png;base64,AAAA")}>서명 입력</button>
    ),
}));

// The rebuilt UI must keep these strings (Phase 3 brief input).
// The rebuilt UI's day card accessible name must contain the service date in one of these formats (Phase 3 brief input).
const PINNED_COPY = {
    /** Title of the invalid-link state (ServiceRecordWizard.tsx:822). */
    invalidLinkTitle: "링크를 사용할 수 없습니다",
    phoneLabel: "휴대폰 번호",
    phoneSubmit: "확인하기",
    /** page.tsx:420 ends with a period; the current widget's own slot message does not. Either satisfies this. */
    phoneRequired: /휴대폰 번호를 입력해 주세요/,
    phoneMismatch: "휴대폰 번호가 일치하지 않아요",
    /** Advances the header step and every input page of a day. */
    next: "다음",
    /** Replaces 다음 on an input page opened from a review section's edit button; it returns to the review. */
    saveSectionEdit: "저장",
    back: "이전",
    /** Step title of the final review page of a day. */
    reviewTitle: "기록 내용 확인",
    /** Opens the submit confirmation from the review page, and approves it inside the dialog. */
    reviewSubmit: "확인",
    submitApprove: "확인",
    /** The only option of the payment item (ServiceRecordWizard.tsx:418). */
    paymentOption: "결제 확인 완료",
    /** Label of the stool-colour text input that "이상변" reveals (ServiceRecordWizard.tsx:317). */
    stoolColorLabel: "이상변의 색깔과 상태",
    scheduleChange: "서비스 일정 변경",
    scheduleChangeApprove: "승인 요청",
};

const HEADER_LABELS = {
    momName: "산모 성명",
    momBirth: "산모 생년월일",
    babyName: "신생아 성명",
    babyBirth: "신생아 출생일자",
    babyWeight: "신생아 몸무게 (kg)",
};
const DELIVERY_LABEL = "분만형태";

const ITEM = Object.fromEntries(DAILY_ITEMS.map((item) => [item.key, item.label])) as Record<string, string>;

/** Only Date is faked: the page, user-event and jsdom history all need real timers. */
const FAKE_DATE_ONLY = [
    "nextTick", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout",
    "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback",
    "hrtime", "performance",
] as const;

type User = ReturnType<typeof userEvent.setup>;

/**
 * A day card is identified by its service date, never by its session number or
 * status words (a card may also show unrelated numbers such as "담당자 1명").
 * The date is matched in any of the formats below so the rebuilt UI can choose one.
 */
// The rebuilt UI's day card accessible name must contain the service date in one of these formats (Phase 3 brief input).
const dayCardByDate = (isoDate: string) => {
    const [year, month, day] = isoDate.split("-").map(Number);
    const m = `0?${month}`;
    const d = `0?${day}`;
    const formats = [
        `${year}[.-]${m}[.-]${d}`, // 2026.09.21, 2026-09-21
        `${m}/${d}`, // 9/21, 09/21
        `${m}\\.${d}`, // 9.21, 09.21
        `${m}월\\s*${d}일`, // 9월 21일
    ];
    return { name: new RegExp(`(?<!\\d)(?:${formats.join("|")})(?!\\d)`) };
};
const dayCard = (sessionIndex: number) => dayCardByDate(PLANNED_DATES[sessionIndex - 1].serviceDate);

const decoration = /^[✓●]\s*/;

/**
 * Chooses one option of one item.
 *
 * `groupName` is the item's visible label (an `ITEM.<key>` entry or the header's
 * `DELIVERY_LABEL`). It must resolve to exactly one radiogroup or group of that
 * accessible name: when it does not, this throws instead of widening the search
 * to the whole screen, where a same-named option of another item could be clicked.
 * The option is then looked up inside that group as radio, then checkbox, then button.
 */
async function chooseOption(user: User, groupName: string, optionText: string) {
    const group = within(optionGroup(groupName));
    const matchesOption = (accessibleName: string) => accessibleName.replace(decoration, "").trim() === optionText;
    for (const role of ["radio", "checkbox", "button"] as const) {
        const found = group.queryAllByRole(role, { name: matchesOption });
        if (found.length > 1) throw new Error(`option "${optionText}" is ambiguous in "${groupName}" (${found.length} ${role}s)`);
        if (found.length === 1) {
            await user.click(found[0]);
            return;
        }
    }
    throw new Error(`option "${optionText}" not found as radio, checkbox or button in "${groupName}"`);
}

/** The one option group named after an item. Throws when there is none, or more than one. */
function optionGroup(groupName: string): HTMLElement {
    const named = (["radiogroup", "group"] as const).flatMap((role) => screen.queryAllByRole(role, { name: groupName }));
    if (named.length !== 1) {
        throw new Error(`expected exactly one group or radiogroup named "${groupName}", found ${named.length}; refusing to search the whole screen`);
    }
    return named[0];
}

const REVIEW_SECTION = { mom: "산모", baby: "신생아", finish: "서비스 기록" } as const;
type ReviewSection = (typeof REVIEW_SECTION)[keyof typeof REVIEW_SECTION];

/**
 * One row of the review screen: the section region, then the row group named
 * after the item. Each value is asserted on its own inside that row, so the same
 * word shown for another item cannot satisfy it.
 */
function reviewRow(section: ReviewSection, itemLabel: string): HTMLElement {
    return within(screen.getByRole("region", { name: section })).getByRole("group", { name: itemLabel });
}

function expectReviewRow(section: ReviewSection, itemLabel: string, ...values: Array<string | RegExp>) {
    const row = reviewRow(section, itemLabel);
    for (const value of values) expect(row).toHaveTextContent(value);
}

function expectNotInReviewRow(section: ReviewSection, itemLabel: string, ...values: string[]) {
    const row = reviewRow(section, itemLabel);
    for (const value of values) expect(row).not.toHaveTextContent(value);
}

/** Numeric count inputs: a number field today, possibly a numeric text field after the rebuild. */
function countInputs(name: string | RegExp): HTMLElement[] {
    return [...screen.queryAllByRole("spinbutton", { name }), ...screen.queryAllByRole("textbox", { name })];
}

function countInput(name: string | RegExp): HTMLElement {
    const found = countInputs(name);
    if (found.length !== 1) throw new Error(`expected one count input named ${String(name)}, found ${found.length}`);
    return found[0];
}

async function fillText(user: User, input: HTMLElement, text: string) {
    await user.clear(input);
    await user.type(input, text);
}

async function renderPage(script: Partial<ApiScript> = {}) {
    const api = installApi(script);
    const user = userEvent.setup();
    render(<ServiceRecordPage />);
    return { api, user };
}

/** Header is saved on the server, nothing submitted yet: the page opens on the session overview. */
const overviewScript = (): Partial<ApiScript> => ({ context: makeContext({ header: SAVED_HEADER }) });

async function openFirstDay(user: User) {
    await user.click(await screen.findByRole("button", dayCard(1)));
    await screen.findByText(ITEM.perineum);
}

/** The 결제 확인 row of a day answered with the payment confirmed (the row reads "✓ 확인 완료"). */
const PAYMENT_REVIEW_VALUE = "확인 완료";

/** What the review shows after the walk-through test's answers, row by row. */
function expectWalkthroughReview() {
    expectReviewRow("산모", ITEM.perineum, "이상없음, 열상");
    expectReviewRow("산모", ITEM.breast, "이상없음");
    expectReviewRow("산모", ITEM.excretion, "이상없음");
    expectReviewRow("산모", ITEM.sitzBath, "미실시");
    expectReviewRow("산모", ITEM.meals, /식사\s*2/, /간식\s*1/);
    expectReviewRow("신생아", ITEM.temperature, "36.5");
    expectReviewRow("신생아", ITEM.sleep, "잘 못 잠");
    expectReviewRow("신생아", ITEM.breastFeeding, "3회");
    expectReviewRow("신생아", ITEM.formulaFeeding, "5회", "회당 90ml");
    expectReviewRow("신생아", ITEM.stool, "이상변", "연두색");
    expectReviewRow("신생아", ITEM.bath, "실시");
    expectReviewRow("서비스 기록", ITEM.etcService, "신생아 옷 정리");
    expectReviewRow("서비스 기록", ITEM.notes, "간식 시간 변경");
    expectReviewRow("서비스 기록", ITEM.paymentConfirmed, PAYMENT_REVIEW_VALUE);
}

/** What the review shows for the answers the server holds (SUBMITTED_ANSWERS), row by row. */
function expectSubmittedReview() {
    expectReviewRow("산모", ITEM.perineum, "혈종");
    expectReviewRow("산모", ITEM.breast, "울혈, 통증");
    expectReviewRow("산모", ITEM.excretion, "불편감");
    expectReviewRow("산모", ITEM.sitzBath, "미실시");
    expectReviewRow("산모", ITEM.meals, /식사\s*3/, /간식\s*2/);
    expectReviewRow("신생아", ITEM.temperature, "37.1");
    expectReviewRow("신생아", ITEM.sleep, "잘 못 잠");
    expectReviewRow("신생아", ITEM.breastFeeding, "4회");
    expectReviewRow("신생아", ITEM.formulaFeeding, "5회", "회당 120ml");
    expectReviewRow("신생아", ITEM.stool, "이상변", "연두색");
    expectReviewRow("신생아", ITEM.bath, "실시");
    expectReviewRow("서비스 기록", ITEM.etcService, "옷 정리");
    expectReviewRow("서비스 기록", ITEM.notes, "산모 요청으로 간식 시간 변경");
    expectReviewRow("서비스 기록", ITEM.paymentConfirmed, PAYMENT_REVIEW_VALUE);
}

interface FeedingCounts { breast: string; formula: string; formulaMl: string }

/** The rows of a day filled by `fillDayUpToReview` that no test chooses differently: still shown in their own rows. */
function expectFilledDayCommonRows() {
    expectReviewRow("산모", ITEM.sitzBath, "실시");
    expectReviewRow("산모", ITEM.meals, /식사\s*2/, /간식\s*1/);
    expectReviewRow("신생아", ITEM.temperature, "36.5");
    expectReviewRow("신생아", ITEM.sleep, "잘 잠");
    expectReviewRow("신생아", ITEM.stool, "정상변");
    expectReviewRow("신생아", ITEM.bath, "실시");
    expectReviewRow("서비스 기록", ITEM.paymentConfirmed, PAYMENT_REVIEW_VALUE);
}

/** Signs, presses the submit button, approves the dialog and returns the body that reached the server. */
async function signAndSubmit(api: ReturnType<typeof installApi>, user: User, { sign = true } = {}) {
    if (sign) await user.click(screen.getByRole("button", { name: "서명 입력" }));
    await user.click(screen.getByRole("button", { name: PINNED_COPY.reviewSubmit }));
    const dialog = await screen.findByRole("dialog");
    // The dialog is only a question: nothing has reached the server before it is approved.
    expect(api.callsTo("POST", "/sessions/1/submit")).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: PINNED_COPY.submitApprove }));
    await waitFor(() => expect(api.callsTo("POST", "/sessions/1/submit")).toHaveLength(1));
    return api.callsTo("POST", "/sessions/1/submit")[0].body as Record<string, unknown>;
}


/**
 * From the first input page of an opened day (① ② ③ already chosen by the
 * caller if they matter) to its review: the minimum valid answers for the rest.
 */
async function fillDayUpToReview(user: User, feeding: FeedingCounts = { breast: "3", formula: "5", formulaMl: "90" }) {
    await chooseOption(user, ITEM.sitzBath, "실시");
    await user.type(countInput(/식사/), "2");
    await user.type(countInput(/간식/), "1");
    await user.click(screen.getByRole("button", { name: PINNED_COPY.next }));

    await screen.findByText(ITEM.temperature);
    await user.type(countInput(/체온/), "36.5");
    await user.type(countInput("모유수유 횟수"), feeding.breast);
    await user.type(countInput("분유수유 횟수"), feeding.formula);
    await user.type(countInput("분유수유 회당"), feeding.formulaMl);
    await chooseOption(user, ITEM.sleep, "잘 잠");
    await chooseOption(user, ITEM.stool, "정상변");
    await user.click(screen.getByRole("button", { name: PINNED_COPY.next }));

    await screen.findByText(ITEM.etcService);
    await user.click(screen.getByRole("button", { name: PINNED_COPY.next }));
    await screen.findByText(FIELD_COPY.paymentConfirm);
    await chooseOption(user, ITEM.paymentConfirmed, PINNED_COPY.paymentOption);
    await user.click(screen.getByRole("button", { name: PINNED_COPY.next }));
    await screen.findByText(PINNED_COPY.reviewTitle);
}

describe("service-record page contract", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        jest.useFakeTimers({ now: NOW, doNotFake: [...FAKE_DATE_ONLY] });
        window.sessionStorage.clear();
        window.localStorage.clear();
        window.history.replaceState(null, "", `/service-record/${TOKEN}`);
    });

    afterEach(() => {
        jest.useRealTimers();
        global.fetch = originalFetch;
    });

    describe("link and phone verification", () => {
        it.each([
            ["1. an invalid or expired link shows the invalid state", { linkValid: false }],
            ["1. a link check that cannot reach the server shows the invalid state", { linkNetworkError: true }],
        ] as const)("%s", async (_name, script) => {
            const { api } = await renderPage(script);

            expect(await screen.findByText(PINNED_COPY.invalidLinkTitle)).toBeInTheDocument();
            expect(screen.queryByLabelText(PINNED_COPY.phoneLabel)).not.toBeInTheDocument();
            expect(api.callsTo("GET", "/context")).toHaveLength(0);
        });

        it("2. submitting an empty phone number asks for it and does not call the server", async () => {
            const { api, user } = await renderPage({ verified: false });
            await screen.findByLabelText(PINNED_COPY.phoneLabel);

            await user.click(screen.getByRole("button", { name: PINNED_COPY.phoneSubmit }));

            expect(await screen.findByText(PINNED_COPY.phoneRequired)).toBeInTheDocument();
            expect(api.callsTo("POST", "/verify")).toHaveLength(0);
        });

        it("2. a number the server rejects shows the mismatch message and stays on the phone step", async () => {
            const { api, user } = await renderPage({ verified: false, verifyOk: false });
            await user.type(await screen.findByLabelText(PINNED_COPY.phoneLabel), "01099998888");

            await user.click(screen.getByRole("button", { name: PINNED_COPY.phoneSubmit }));

            expect(await screen.findByText(PINNED_COPY.phoneMismatch)).toBeInTheDocument();
            expect(screen.getByLabelText(PINNED_COPY.phoneLabel)).toBeInTheDocument();
            expect(screen.queryByLabelText(HEADER_LABELS.momName)).not.toBeInTheDocument();
            const [verify] = api.callsTo("POST", "/verify");
            expect(String((verify.body as { phone: string }).phone).replace(/\D/g, "")).toBe("01099998888");
        });

        it("2. the correct number posts its digits to /verify and reveals the basic-information step", async () => {
            const { api, user } = await renderPage({ verified: false, verifyOk: true });
            await user.type(await screen.findByLabelText(PINNED_COPY.phoneLabel), "01012345678");

            await user.click(screen.getByRole("button", { name: PINNED_COPY.phoneSubmit }));

            expect(await screen.findByLabelText(HEADER_LABELS.momName)).toBeInTheDocument();
            expect(api.callsTo("POST", "/verify")).toHaveLength(1);
            const [verify] = api.callsTo("POST", "/verify");
            expect(String((verify.body as { phone: string }).phone).replace(/\D/g, "")).toBe("01012345678");
            // The first context read was refused (not verified yet); the page reads it again after verifying.
            expect(api.callsTo("GET", "/context")).toHaveLength(2);
        });
    });

    describe("basic information (header)", () => {
        it("3. pressing next on an empty form shows every required message and saves nothing", async () => {
            const { api, user } = await renderPage();
            await screen.findByLabelText(HEADER_LABELS.momName);

            await user.click(screen.getByRole("button", { name: PINNED_COPY.next }));

            expect(await screen.findByText("산모 성명을 입력해 주세요")).toBeInTheDocument();
            expect(screen.getByText("산모 생년월일을 입력해 주세요")).toBeInTheDocument();
            expect(screen.getByText("신생아 성명을 입력해 주세요")).toBeInTheDocument();
            expect(screen.getByText("신생아 출생일자를 입력해 주세요")).toBeInTheDocument();
            expect(screen.getByText("신생아 몸무게를 입력해 주세요")).toBeInTheDocument();
            expect(api.callsTo("PUT", "/header")).toHaveLength(0);
        });

        it("3. a partial birthday is flagged once the field is left, and digits are formatted as a date", async () => {
            const { user } = await renderPage();
            const birth = await screen.findByLabelText(HEADER_LABELS.momBirth);

            await user.type(birth, "1999");
            await user.tab();
            expect(screen.getByText(FIELD_COPY.dateError)).toBeInTheDocument();

            await fillText(user, birth, "19940315");
            expect(birth).toHaveValue("1994-03-15");
            expect(screen.queryByText(FIELD_COPY.dateError)).not.toBeInTheDocument();
        });

        it("3. a birthday in the future is rejected", async () => {
            const { user } = await renderPage();
            const birth = await screen.findByLabelText(HEADER_LABELS.momBirth);

            await user.type(birth, "20270101");
            await user.tab();

            expect(screen.getByText("미래 날짜는 입력할 수 없어요")).toBeInTheDocument();
        });

        it("3. a valid header is sent to PUT /header with ISO dates and the session overview appears", async () => {
            const { api, user } = await renderPage();
            await user.type(await screen.findByLabelText(HEADER_LABELS.momName), SAVED_HEADER.momName);
            await user.type(screen.getByLabelText(HEADER_LABELS.momBirth), "19940315");
            await user.type(screen.getByLabelText(HEADER_LABELS.babyName), SAVED_HEADER.babyName);
            await user.type(screen.getByLabelText(HEADER_LABELS.babyBirth), "20260910");
            await user.type(screen.getByLabelText(HEADER_LABELS.babyWeight), SAVED_HEADER.babyWeight);
            await chooseOption(user, DELIVERY_LABEL, "제왕절개");

            await user.click(screen.getByRole("button", { name: PINNED_COPY.next }));

            await waitFor(() => expect(api.callsTo("PUT", "/header")).toHaveLength(1));
            expect(api.callsTo("PUT", "/header")[0].body).toEqual({
                ...SAVED_HEADER,
                deliveryType: "제왕절개",
            });
            expect(await screen.findByRole("button", dayCard(1))).toBeInTheDocument();
            expect(screen.getByRole("button", dayCard(3))).toBeInTheDocument();
        });
    });

    describe("daily record", () => {
        it("4. opening the 1회 card shows the first daily item", async () => {
            const { user } = await renderPage(overviewScript());

            await user.click(await screen.findByRole("button", dayCard(1)));

            expect(await screen.findByText(ITEM.perineum)).toBeInTheDocument();
            expect(screen.getByText(SERVER_NAMES.provider)).toBeInTheDocument();
        });

        it("5. next with an unanswered required item does not advance and shows that item's message", async () => {
            const { user } = await renderPage(overviewScript());
            await openFirstDay(user);

            await user.click(screen.getByRole("button", { name: PINNED_COPY.next }));

            expect(await screen.findByText("식사를 입력해 주세요")).toBeInTheDocument();
            expect(screen.getByText(ITEM.perineum)).toBeInTheDocument();
            expect(screen.queryByText(ITEM.temperature)).not.toBeInTheDocument();
        });

        it("5. back returns exactly one page and keeps what was entered", async () => {
            const { user } = await renderPage(overviewScript());
            await openFirstDay(user);
            await user.type(countInput(/식사/), "2");
            await user.type(countInput(/간식/), "1");
            await user.click(screen.getByRole("button", { name: PINNED_COPY.next }));
            await screen.findByText(ITEM.temperature);

            await user.click(screen.getByRole("button", { name: PINNED_COPY.back }));

            expect(await screen.findByText(ITEM.perineum)).toBeInTheDocument();
            expect(screen.queryByText(ITEM.temperature)).not.toBeInTheDocument();
            expect((countInput(/식사/) as HTMLInputElement).value).toBe("2");
            expect((countInput(/간식/) as HTMLInputElement).value).toBe("1");
        });

        it("5. walks the three input pages, reviews the answers and submits them with the signature", async () => {
            const { api, user } = await renderPage(overviewScript());
            await openFirstDay(user);

            // Page 1 (산모 기록): ⑤ 식사/간식 is unanswered, so next does not advance.
            await chooseOption(user, ITEM.perineum, "열상");
            await chooseOption(user, ITEM.sitzBath, "미실시");
            await user.click(screen.getByRole("button", { name: PINNED_COPY.next }));
            expect(await screen.findByText("식사를 입력해 주세요")).toBeInTheDocument();
            expect(screen.getByText(ITEM.perineum)).toBeInTheDocument();
            expect(screen.queryByText(ITEM.temperature)).not.toBeInTheDocument();
            await user.type(countInput(/식사/), "2");
            await user.type(countInput(/간식/), "1");
            await user.click(screen.getByRole("button", { name: PINNED_COPY.next }));

            // Page 2 (신생아 기록): an abnormal stool needs its colour before next advances.
            await screen.findByText(ITEM.temperature);
            await user.type(countInput(/체온/), "36.5");
            // ⑧ 모유수유 and ⑨ 분유수유 each have their own 횟수, and they differ.
            await user.type(countInput("모유수유 횟수"), "3");
            await user.type(countInput("분유수유 횟수"), "5");
            await user.type(countInput("분유수유 회당"), "90");
            await chooseOption(user, ITEM.sleep, "잘 못 잠");
            await chooseOption(user, ITEM.stool, "이상변");
            await user.click(screen.getByRole("button", { name: PINNED_COPY.next }));
            expect(await screen.findByText(FIELD_COPY.stoolColor)).toBeInTheDocument();
            expect(screen.queryByText(ITEM.etcService)).not.toBeInTheDocument();
            await user.type(screen.getByLabelText(PINNED_COPY.stoolColorLabel), "연두색");
            await user.click(screen.getByRole("button", { name: PINNED_COPY.next }));

            // Page 3 (서비스 기록): the payment confirmation is required.
            await screen.findByText(ITEM.etcService);
            await user.type(screen.getByLabelText(ITEM.etcService), "신생아 옷 정리");
            await user.type(screen.getByLabelText(ITEM.notes), "간식 시간 변경");
            await user.click(screen.getByRole("button", { name: PINNED_COPY.next }));
            expect(await screen.findByText(FIELD_COPY.paymentConfirm)).toBeInTheDocument();
            expect(screen.queryByText(PINNED_COPY.reviewTitle)).not.toBeInTheDocument();
            await chooseOption(user, ITEM.paymentConfirmed, PINNED_COPY.paymentOption);
            await user.click(screen.getByRole("button", { name: PINNED_COPY.next }));

            // Review: every answered item shows its own value in its own row.
            expect(await screen.findByText(PINNED_COPY.reviewTitle)).toBeInTheDocument();
            expectWalkthroughReview();

            // 이전 goes back exactly one page and keeps the answers.
            await user.click(screen.getByRole("button", { name: PINNED_COPY.back }));
            expect(await screen.findByText(ITEM.etcService)).toBeInTheDocument();
            expect(screen.queryByText(PINNED_COPY.reviewTitle)).not.toBeInTheDocument();
            expect(screen.getByLabelText(ITEM.etcService)).toHaveValue("신생아 옷 정리");
            await user.click(screen.getByRole("button", { name: PINNED_COPY.next }));
            await screen.findByText(PINNED_COPY.reviewTitle);
            expectWalkthroughReview();

            // Sign, submit and confirm.
            const body = await signAndSubmit(api, user);
            expect(api.callsTo("POST", "/sessions/1/submit")).toHaveLength(1);
            expect(body).toMatchObject({
                serviceDate: "2026-09-21",
                etcService: "신생아 옷 정리",
                notes: "간식 시간 변경",
                paymentConfirmed: true,
                momApproval: "approved",
                clientSignature: "data:image/png;base64,AAAA",
                answers: {
                    perineum: ["이상없음", "열상"],
                    breast: ["이상없음"],
                    excretion: ["이상없음"],
                    sitzBath: "미실시",
                    meals_meal: "2",
                    meals_snack: "1",
                    temperature_temp: "36.5",
                    sleep: "잘 못 잠",
                    breastFeeding_count: "3",
                    formulaFeeding_count: "5",
                    formulaFeeding_ml: "90",
                    stool: "이상변",
                    stool_color: "연두색",
                    bath: "실시",
                },
            });
            // The server now holds 1 of 3 sessions: back on the overview, 2회 is next.
            expect(await screen.findByRole("button", dayCard(2))).toBeEnabled();
        });

        it("5. ①, ② and ③ are answered independently: each item's own answer reaches the server and its own review row", async () => {
            const { api, user } = await renderPage(overviewScript());
            await openFirstDay(user);

            // A new day starts with 이상없음 chosen for ①②③. ① keeps it and adds 열상,
            // ② swaps it for 울혈, ③ is left alone.
            await chooseOption(user, ITEM.perineum, "열상");
            await chooseOption(user, ITEM.breast, "울혈");
            await chooseOption(user, ITEM.breast, "이상없음");
            await fillDayUpToReview(user);

            expectReviewRow("산모", ITEM.perineum, "이상없음, 열상");
            expectReviewRow("산모", ITEM.breast, "울혈");
            expectNotInReviewRow("산모", ITEM.breast, "이상없음");
            expectReviewRow("산모", ITEM.excretion, "이상없음");
            expectNotInReviewRow("산모", ITEM.excretion, "불편감");
            expectFilledDayCommonRows();

            const body = await signAndSubmit(api, user);
            expect(body.answers).toMatchObject({
                perineum: ["이상없음", "열상"],
                breast: ["울혈"],
                excretion: ["이상없음"],
            });
        });

        it("5. 모유수유 횟수 and 분유수유 횟수 hold different values in the payload and in their own review rows", async () => {
            const { api, user } = await renderPage(overviewScript());
            await openFirstDay(user);

            await fillDayUpToReview(user, { breast: "7", formula: "2", formulaMl: "60" });

            expectReviewRow("신생아", ITEM.breastFeeding, "7회");
            expectNotInReviewRow("신생아", ITEM.breastFeeding, "2회");
            expectReviewRow("신생아", ITEM.formulaFeeding, "2회", "회당 60ml");
            expectNotInReviewRow("신생아", ITEM.formulaFeeding, "7회");
            expectFilledDayCommonRows();

            const body = await signAndSubmit(api, user);
            expect(body.answers).toMatchObject({
                breastFeeding_count: "7",
                formulaFeeding_count: "2",
                formulaFeeding_ml: "60",
            });
        });

        it("6. a submitted day re-opens on the review with the answers the server holds", async () => {
            const { user } = await renderPage({
                context: makeContext({ header: SAVED_HEADER, sessions: [makeSubmittedFirstSession(), makeSession(2), makeSession(3)] }),
            });

            await user.click(await screen.findByRole("button", dayCard(1)));

            expect(await screen.findByText(PINNED_COPY.reviewTitle)).toBeInTheDocument();
            expectSubmittedReview();
        });

        it("6. re-submitting a re-opened day sends the server's answers unchanged and keeps the saved signature", async () => {
            const { api, user } = await renderPage({
                context: makeContext({ header: SAVED_HEADER, sessions: [makeSubmittedFirstSession(), makeSession(2), makeSession(3)] }),
            });
            await user.click(await screen.findByRole("button", dayCard(1)));
            await screen.findByText(PINNED_COPY.reviewTitle);

            await user.click(screen.getByRole("button", { name: PINNED_COPY.reviewSubmit }));
            const dialog = await screen.findByRole("dialog");
            expect(api.callsTo("POST", "/sessions/1/submit")).toHaveLength(0);
            await user.click(within(dialog).getByRole("button", { name: PINNED_COPY.submitApprove }));

            await waitFor(() => expect(api.callsTo("POST", "/sessions/1/submit")).toHaveLength(1));
            const [{ body }] = api.callsTo("POST", "/sessions/1/submit");
            expect(body).toMatchObject({
                serviceDate: "2026-09-21",
                etcService: "옷 정리",
                notes: "산모 요청으로 간식 시간 변경",
                paymentConfirmed: true,
                answers: SUBMITTED_ANSWERS,
            });
            expect(body).not.toHaveProperty("clientSignature");
        });

        // Extra (not numbered in the brief): the schedule-change request is an overview action that reaches the server.
        it("a schedule change is requested only after the previewed change is approved", async () => {
            const { api, user } = await renderPage(overviewScript());

            await user.click(await screen.findByRole("button", { name: PINNED_COPY.scheduleChange }));
            const dialog = await screen.findByRole("dialog");
            await waitFor(() => expect(api.callsTo("GET", "/schedule-change/preview")).toHaveLength(1));
            expect(api.callsTo("POST", "/schedule-change")).toHaveLength(0);
            const approve = await within(dialog).findByRole("button", { name: PINNED_COPY.scheduleChangeApprove });
            await waitFor(() => expect(approve).toBeEnabled());
            await user.click(approve);

            await waitFor(() => expect(api.callsTo("POST", "/schedule-change")).toHaveLength(1));
        });

        it("6. 신생아 수정 on the review of a submitted day opens the 신생아 page, and a change made there is what gets re-submitted", async () => {
            const { api, user } = await renderPage({
                context: makeContext({ header: SAVED_HEADER, sessions: [makeSubmittedFirstSession(), makeSession(2), makeSession(3)] }),
            });
            await user.click(await screen.findByRole("button", dayCard(1)));
            await screen.findByText(PINNED_COPY.reviewTitle);
            expectSubmittedReview();

            await user.click(screen.getByRole("button", { name: "신생아 수정" }));

            // The 신생아 page: a 신생아 item is on screen, no 산모 item is.
            expect(await screen.findByText(ITEM.temperature)).toBeInTheDocument();
            expect(screen.queryByText(ITEM.perineum)).not.toBeInTheDocument();
            expect(screen.queryByText(PINNED_COPY.reviewTitle)).not.toBeInTheDocument();
            await chooseOption(user, ITEM.sleep, "잘 잠");
            await user.click(screen.getByRole("button", { name: PINNED_COPY.saveSectionEdit }));

            // Back on the review, the changed answer sits in its own row; the others are untouched.
            await screen.findByText(PINNED_COPY.reviewTitle);
            expectReviewRow("신생아", ITEM.sleep, "잘 잠");
            expectNotInReviewRow("신생아", ITEM.sleep, "잘 못 잠");
            expectReviewRow("신생아", ITEM.stool, "이상변", "연두색");
            expectReviewRow("서비스 기록", ITEM.paymentConfirmed, PAYMENT_REVIEW_VALUE);

            const body = await signAndSubmit(api, user, { sign: false });
            expect(body.answers).toMatchObject({ ...SUBMITTED_ANSWERS, sleep: "잘 잠" });
            expect(body).toMatchObject({ etcService: "옷 정리", notes: "산모 요청으로 간식 시간 변경", paymentConfirmed: true });
            expect(body).not.toHaveProperty("clientSignature");
        });
    });
});
