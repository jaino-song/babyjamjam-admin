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

/** A 회차 card is identified by its number only (not by its date or status words). */
const dayCard = (sessionIndex: number) => ({ name: new RegExp(`(^|\\D)${sessionIndex}(?!\\d)`) });

const decoration = /^[✓●]\s*/;

/**
 * Chooses one option of an item.
 *
 * `scope` is the item's visible title (or a container element). A title only
 * counts when it resolves to a semantic container (radiogroup, group, region or
 * fieldset): if it does not, this throws instead of widening the search to the
 * whole screen, where a same-named option of another item could be clicked.
 * With `scope` explicitly `undefined` the whole screen is searched, and the
 * option must then be the only control of that name on the screen.
 * Options are looked up as radio, then checkbox, then button.
 */
async function chooseOption(user: User, scope: string | HTMLElement | undefined, optionText: string) {
    const root = scopeFor(scope);
    const matchesOption = (accessibleName: string) => accessibleName.replace(decoration, "").trim() === optionText;
    const byRole = (["radio", "checkbox", "button"] as const).map((role) => ({
        role,
        found: root.queryAllByRole(role, { name: matchesOption }),
    }));
    if (scope === undefined) {
        const all = byRole.flatMap(({ found }) => found);
        if (all.length !== 1) {
            throw new Error(`option "${optionText}" must be the only control of that name on screen, found ${all.length}`);
        }
        await user.click(all[0]);
        return;
    }
    for (const { role, found } of byRole) {
        if (found.length > 1) throw new Error(`option "${optionText}" is ambiguous (${found.length} ${role}s); scope it`);
        if (found.length === 1) {
            await user.click(found[0]);
            return;
        }
    }
    throw new Error(`option "${optionText}" not found as radio, checkbox or button`);
}

/** An option whose name is unique on screen, so no container is needed to pick it. */
const chooseUniqueOption = (user: User, optionText: string) => chooseOption(user, undefined, optionText);

const SCOPE_ROLES = ["radiogroup", "group", "region"] as const;

function scopeFor(scope: string | HTMLElement | undefined): ReturnType<typeof within> {
    if (scope instanceof HTMLElement) return within(scope);
    if (scope === undefined) return screen;
    const candidates = SCOPE_ROLES.flatMap((role) => screen.queryAllByRole(role));
    const named = SCOPE_ROLES.flatMap((role) => screen.queryAllByRole(role, { name: scope }));
    if (named.length === 1) return within(named[0]);
    // A container that holds the item's title as text; the innermost one wins.
    const holding = candidates.filter((candidate) => within(candidate).queryAllByText(scope).length > 0);
    const innermost = holding.filter((candidate) => !holding.some((other) => other !== candidate && candidate.contains(other)));
    if (innermost.length === 1) return within(innermost[0]);
    throw new Error(
        `no accessible group, radiogroup or region labelled or titled "${scope}" (${named.length} named, ${innermost.length} innermost holding it); `
        + "refusing to search the whole screen",
    );
}

/**
 * The review screen shows each chosen value; whether a value sits in one text
 * node ("이상없음, 열상") or one chip each does not matter to the user. So every
 * value is asserted on its own against the combined text of what is on screen
 * (the review is the only page shown), never as one joined string.
 */
function expectReviewShows(...values: Array<string | RegExp>) {
    for (const value of values) expect(document.body).toHaveTextContent(value);
}

/** Numeric count inputs: a number field today, possibly a numeric text field after the rebuild. */
function countInputs(name: RegExp): HTMLElement[] {
    return [...screen.queryAllByRole("spinbutton", { name }), ...screen.queryAllByRole("textbox", { name })];
}

function countInput(name: RegExp): HTMLElement {
    const found = countInputs(name);
    if (found.length !== 1) throw new Error(`expected one count input named ${name}, found ${found.length}`);
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
            await chooseUniqueOption(user, "제왕절개"); // 분만형태

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
            await chooseUniqueOption(user, "열상"); // ① 회음절개부위
            await chooseUniqueOption(user, "미실시"); // 좌욕
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
            // ⑧ 모유수유 and ⑨ 분유수유 share the accessible name 횟수: both get the same count.
            for (const count of countInputs(/횟수/)) await user.type(count, "3");
            await user.type(countInput(/회당/), "90");
            await chooseUniqueOption(user, "잘 못 잠"); // 수면
            await chooseUniqueOption(user, "이상변"); // 대변
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
            await chooseUniqueOption(user, PINNED_COPY.paymentOption); // 결제 확인
            await user.click(screen.getByRole("button", { name: PINNED_COPY.next }));

            // Review: the chosen values are shown.
            expect(await screen.findByText(PINNED_COPY.reviewTitle)).toBeInTheDocument();
            expectReviewShows("이상없음", "열상", "미실시", "잘 못 잠", "이상변", "연두색", "신생아 옷 정리", "간식 시간 변경");

            // 이전 goes back exactly one page and keeps the answers.
            await user.click(screen.getByRole("button", { name: PINNED_COPY.back }));
            expect(await screen.findByText(ITEM.etcService)).toBeInTheDocument();
            expect(screen.queryByText(PINNED_COPY.reviewTitle)).not.toBeInTheDocument();
            expect(screen.getByLabelText(ITEM.etcService)).toHaveValue("신생아 옷 정리");
            await user.click(screen.getByRole("button", { name: PINNED_COPY.next }));
            await screen.findByText(PINNED_COPY.reviewTitle);
            expectReviewShows("이상없음", "열상");

            // Sign, submit and confirm.
            await user.click(screen.getByRole("button", { name: "서명 입력" }));
            await user.click(screen.getByRole("button", { name: PINNED_COPY.reviewSubmit }));
            const dialog = await screen.findByRole("dialog");
            expect(api.callsTo("POST", "/sessions/1/submit")).toHaveLength(0);
            await user.click(within(dialog).getByRole("button", { name: PINNED_COPY.submitApprove }));

            await waitFor(() => expect(api.callsTo("POST", "/sessions/1/submit")).toHaveLength(1));
            const [{ body }] = api.callsTo("POST", "/sessions/1/submit");
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
                    formulaFeeding_count: "3",
                    formulaFeeding_ml: "90",
                    stool: "이상변",
                    stool_color: "연두색",
                    bath: "실시",
                },
            });
            // The server now holds 1 of 3 sessions: back on the overview, 2회 is next.
            expect(await screen.findByRole("button", dayCard(2))).toBeEnabled();
        });

        it("6. a submitted day re-opens on the review with the answers the server holds", async () => {
            const { user } = await renderPage({
                context: makeContext({ header: SAVED_HEADER, sessions: [makeSubmittedFirstSession(), makeSession(2), makeSession(3)] }),
            });

            await user.click(await screen.findByRole("button", dayCard(1)));

            expect(await screen.findByText(PINNED_COPY.reviewTitle)).toBeInTheDocument();
            expectReviewShows(
                "혈종", "울혈", "통증", "불편감", "미실시", "잘 못 잠", "이상변", "연두색",
                /식사\s*3/, /37\.1/, /120/, "옷 정리", "산모 요청으로 간식 시간 변경",
            );
        });

        it("6. re-submitting a re-opened day sends the server's answers unchanged and keeps the saved signature", async () => {
            const { api, user } = await renderPage({
                context: makeContext({ header: SAVED_HEADER, sessions: [makeSubmittedFirstSession(), makeSession(2), makeSession(3)] }),
            });
            await user.click(await screen.findByRole("button", dayCard(1)));
            await screen.findByText(PINNED_COPY.reviewTitle);

            await user.click(screen.getByRole("button", { name: PINNED_COPY.reviewSubmit }));
            const dialog = await screen.findByRole("dialog");
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

        it.todo("5. change the ②유방상태 or ③배뇨/배변 answer independently of ① — blocked: packages/service-record-ui/src/ServiceRecordWizard.tsx:150-167 option buttons sit in a div without a group role, and 이상없음/불편감 repeat across ①②③");
        it.todo("5. fill 모유수유 횟수 and 분유수유 횟수 with different values — blocked: packages/service-record-ui/src/ServiceRecordWizard.tsx:359-363 both inputs are named 횟수 with no group container");
        it.todo("6. edit one section from the review of a submitted day — blocked: packages/service-record-ui/src/ServiceRecordWizard.tsx:452-459 each review section has an identically named 수정 button and no accessible container");
    });
});
