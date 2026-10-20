import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
    DEFAULT_DAILY_ANSWERS,
    ServiceRecordWizard as SharedWizard,
    type ServiceRecordWizardProps,
} from "@babyjamjam/service-record-ui";

import { DayPageStep } from "../DayPageStep";
import { useServiceDateFieldState } from "../serviceDateFieldState";

const ROOT = "mobile_service-record_wizard";

type Calls = Array<[string, unknown]>;

const sharedProps = (
    pageIdx: number,
    draft: Record<string, unknown>,
    onFieldChange: (key: string, value: unknown) => void,
): ServiceRecordWizardProps => ({
    "data-component": ROOT, screen: "day", phone: "", phoneError: null,
    context: { totalSessions: 5, startDate: "2026-09-21", header: null, sessions: [] },
    header: {}, day: 1, pageIdx, draft, editing: false, clientSignature: null,
    busy: false, isRecordFinalized: false, lockedDays: new Set<number>(), nextOpenDay: () => 1,
    scheduleChangeBusy: false, hasServiceDateMismatch: false, defaultDate: () => "2026-09-21",
    onPhoneChange: jest.fn(), onSubmitPhone: jest.fn(), onBack: jest.fn(), onHeaderChange: jest.fn(),
    onDeliveryTypeChange: jest.fn(), onSaveHeader: jest.fn(), onOpenDay: jest.fn(),
    onOpenScheduleChangePreview: jest.fn(), onServiceDateChange: jest.fn(), onFieldChange,
    onToggleMulti: jest.fn(), onSignatureChange: jest.fn(), onNextPage: jest.fn(),
    onOpenSubmitModal: jest.fn(), onEditSection: jest.fn(),
});

function SharedHarness({ pageIdx, calls }: { pageIdx: number; calls: Calls }) {
    const [draft, setDraft] = useState<Record<string, unknown>>({ ...DEFAULT_DAILY_ANSWERS });
    return <SharedWizard {...sharedProps(pageIdx, draft, (key, value) => {
        calls.push([key, value]);
        setDraft((current) => ({ ...current, [key]: value }));
    })} />;
}

function ScreenHarness({ pageIdx, calls }: { pageIdx: number; calls: Calls }) {
    const [draft, setDraft] = useState<Record<string, unknown>>({ ...DEFAULT_DAILY_ANSWERS });
    const { onBack, onServiceDateChange, onOpenScheduleChangePreview, onToggleMulti, onNextPage } = sharedProps(pageIdx, draft, jest.fn());
    const dateState = useServiceDateFieldState({ currentServiceDate: "2026-09-21", day: 1 });
    return (
        <DayPageStep
            data-component={ROOT}
            context={{ totalSessions: 5, startDate: "2026-09-21", header: null, sessions: [] }}
            day={1}
            pageIdx={pageIdx}
            draft={draft}
            editing={false}
            isRecordFinalized={false}
            scheduleChangeBusy={false}
            hasServiceDateMismatch={false}
            defaultDate={() => "2026-09-21"}
            onBack={onBack}
            onServiceDateChange={onServiceDateChange}
            onOpenScheduleChangePreview={onOpenScheduleChangePreview}
            onToggleMulti={onToggleMulti}
            onNextPage={onNextPage}
            dateState={dateState}
            onFieldChange={(key, value) => {
                calls.push([key, value]);
                setDraft((current) => ({ ...current, [key]: value }));
            }}
        />
    );
}

const slotText = (input: HTMLElement) => document.getElementById(input.getAttribute("aria-describedby")!)!.textContent;

async function typeInto(Harness: typeof SharedHarness, pageIdx: number, label: string, text: string) {
    const calls: Calls = [];
    const user = userEvent.setup();
    const { unmount } = render(<Harness pageIdx={pageIdx} calls={calls} />);
    const input = screen.getByLabelText(label);
    await user.type(input, text);
    const result = {
        type: input.getAttribute("type"),
        min: input.getAttribute("min"),
        step: input.getAttribute("step"),
        inputMode: input.getAttribute("inputmode"),
        placeholder: input.getAttribute("placeholder"),
        calls,
        value: (input as HTMLInputElement).value,
        invalid: input.getAttribute("aria-invalid"),
        message: slotText(input),
    };
    unmount();
    return result;
}

describe("count inputs behave like the shared wizard's", () => {
    it.each([
        ["식사", 0, "abc"],
        ["식사", 0, "3"],
        ["체온", 1, "36.6"],
        ["체온", 1, "abc"],
        ["모유수유 횟수", 1, "2.5"],
        ["분유수유 회당", 1, "80"],
    ])("typing %s on page %i with %j gives the same attributes, callbacks and messages", async (label, pageIdx, text) => {
        const shared = await typeInto(SharedHarness, pageIdx, label, text);
        const screenResult = await typeInto(ScreenHarness, pageIdx, label, text);
        expect(screenResult).toEqual(shared);
    });

    it("emits no callback for non-numeric characters, like a native number input", async () => {
        const result = await typeInto(ScreenHarness, 0, "식사", "abc");
        expect(result.calls).toEqual([]);
        expect(result.type).toBe("number");
    });
});
