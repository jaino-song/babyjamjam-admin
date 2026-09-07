import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render } from "@testing-library/react";
import type { ServiceRecordWizardProps } from "@babyjamjam/service-record-ui";
import {
    DAILY_ITEMS,
    DAY_PAGES,
    DEFAULT_DAILY_ANSWERS,
    ServiceRecordWizard,
} from "@babyjamjam/service-record-ui";

const dataComponent = "mobile_service-record_wizard";

const context = {
    org: { name: "테스트 제공기관" },
    employee: { id: 1, name: "제공인력" },
    client: { id: 2, name: "이용자" },
    totalSessions: 2,
    startDate: "2026-07-17",
    header: {
        momName: "김산모",
        momBirth: "900101",
        babyName: "김아기",
        babyBirth: "260714",
        babyWeight: "3.2",
        deliveryType: "자연분만",
    },
    sessions: [],
    recordStatus: "IN_PROGRESS",
    pendingScheduleChange: null,
};

function makeProps(overrides: Partial<ServiceRecordWizardProps> = {}): ServiceRecordWizardProps {
    return {
        "data-component": dataComponent,
        screen: "day",
        phone: "010-1234-5678",
        phoneError: null,
        context,
        header: context.header,
        day: 1,
        pageIdx: 0,
        draft: { ...DEFAULT_DAILY_ANSWERS },
        editing: false,
        clientSignature: null,
        busy: false,
        isRecordFinalized: false,
        lockedDays: new Set<number>(),
        nextOpenDay: () => 1,
        scheduleChangeBusy: false,
        hasServiceDateMismatch: false,
        defaultDate: () => "2026-07-17",
        onPhoneChange: jest.fn(),
        onSubmitPhone: jest.fn(),
        onBack: jest.fn(),
        onHeaderChange: jest.fn(),
        onDeliveryTypeChange: jest.fn(),
        onSaveHeader: jest.fn(),
        onOpenDay: jest.fn(),
        onOpenScheduleChangePreview: jest.fn(),
        onServiceDateChange: jest.fn(),
        onFieldChange: jest.fn(),
        onToggleMulti: jest.fn(),
        onSignatureChange: jest.fn(),
        onNextPage: jest.fn(),
        onOpenSubmitModal: jest.fn(),
        onEditSection: jest.fn(),
        slots: {
            provider: ({ "data-component": providerDataComponent }) => (
                <div data-component={providerDataComponent}>provider</div>
            ),
            signature: ({ "data-component": signatureDataComponent }) => (
                <div data-component={signatureDataComponent}>signature</div>
            ),
        },
        ...overrides,
    };
}

describe("shared service-record UI contract", () => {
    it("keeps all 14 daily items, their subinputs, and four wizard pages", () => {
        expect(DAILY_ITEMS).toHaveLength(14);
        expect(DAILY_ITEMS.map((item) => item.key)).toEqual([
            "perineum",
            "breast",
            "excretion",
            "sitzBath",
            "meals",
            "temperature",
            "sleep",
            "breastFeeding",
            "formulaFeeding",
            "stool",
            "bath",
            "etcService",
            "notes",
            "paymentConfirmed",
        ]);
        expect(DAILY_ITEMS.map((item) => item.opts ?? null)).toEqual([
            ["이상없음", "열상", "혈종", "불편감"],
            ["이상없음", "울혈", "통증"],
            ["이상없음", "불편감"],
            ["실시", "미실시"],
            null,
            null,
            ["잘 잠", "잘 못 잠"],
            null,
            null,
            ["정상변", "이상변"],
            ["실시", "미실시"],
            null,
            null,
            null,
        ]);
        expect(DAILY_ITEMS.find((item) => item.key === "meals")?.counts).toEqual([
            { k: "meal", label: "식사", unit: "회" },
            { k: "snack", label: "간식", unit: "회" },
        ]);
        expect(DAILY_ITEMS.find((item) => item.key === "formulaFeeding")?.counts).toEqual([
            { k: "count", label: "횟수", unit: "회" },
            { k: "ml", label: "회당", unit: "ml" },
        ]);
        expect(DAILY_ITEMS.find((item) => item.key === "etcService")?.maxLength).toBe(40);
        expect(DAILY_ITEMS.find((item) => item.key === "notes")?.maxLength).toBe(80);
        expect(DAY_PAGES).toEqual([
            { title: "산모 기록", items: [0, 1, 2, 3, 4] },
            { title: "신생아 기록", items: [5, 6, 7, 8, 9, 10] },
            { title: "서비스 기록", items: [11, 12, 13] },
            { title: "기록 내용 확인", items: [], confirmation: true },
        ]);
    });

    it("renders each day page with the full caller data-component prefix", () => {
        const { container, rerender } = render(<ServiceRecordWizard {...makeProps({ pageIdx: 0 })} />);

        expect(container.firstElementChild).toHaveAttribute("data-source-component", "ServiceRecordWizard");
        expect(container.querySelectorAll('[data-component="mobile_service-record_wizard_body_day-field"]')).toHaveLength(5);
        expect(container.querySelector('[data-component="mobile_service-record_wizard_body_day-field_options"]')).toHaveAttribute("data-slot", "opts");
        expect(container.querySelector('[data-component="mobile_service-record_wizard_body_day-field_options"] .opt')).toHaveAttribute("data-slot", "opt");
        expect(container.querySelector('[data-component="mobile_service-record_wizard_body_day-field_options"] .box')).toHaveAttribute("data-slot", "box");
        expect(container.querySelector('[data-component="mobile_service-record_wizard_body_day-field_radio-options"]')).toBeInTheDocument();
        expect(container.querySelector('[data-component="mobile_service-record_wizard_body_day-field_count-options_row"]')).toBeInTheDocument();

        rerender(<ServiceRecordWizard {...makeProps({ pageIdx: 1 })} />);
        expect(container.querySelectorAll('[data-component="mobile_service-record_wizard_body_day-field"]')).toHaveLength(6);
        expect(container.querySelectorAll('[data-component="mobile_service-record_wizard_body_day-field_count-options_row"]')).toHaveLength(4);
        expect(container.querySelector('[data-component="mobile_service-record_wizard_body_day-field_radio-options"]')).toBeInTheDocument();

        rerender(<ServiceRecordWizard {...makeProps({ pageIdx: 1, draft: { ...DEFAULT_DAILY_ANSWERS, stool: "이상변" } })} />);
        expect(container.querySelector('input[placeholder="색깔 등 (이상변 시)"]')).toBeInTheDocument();

        rerender(<ServiceRecordWizard {...makeProps({ pageIdx: 2 })} />);
        expect(container.querySelectorAll('[data-component="mobile_service-record_wizard_body_day-field"]')).toHaveLength(3);
        expect(container.querySelector('[data-component="mobile_service-record_wizard_body_day-field_etc-service"]')).toHaveAttribute("maxlength", "40");
        expect(container.querySelector('[data-component="mobile_service-record_wizard_body_day-field_notes"]')).toHaveAttribute("maxlength", "80");
        expect(container.querySelector('[data-component="mobile_service-record_wizard_body_day-field_confirm-options"]')).toBeInTheDocument();

        rerender(<ServiceRecordWizard {...makeProps({ pageIdx: 3 })} />);
        expect(container.querySelectorAll('[data-component="mobile_service-record_wizard_body_review_section"]')).toHaveLength(3);
        expect(container.querySelector('[data-component="mobile_service-record_wizard_body_mom-sign"]')).toHaveTextContent("signature");
    });

    it("keeps the shared package free of app, persistence, and network imports", () => {
        const packageSourceRoot = resolve(__dirname, "../../../../../packages/service-record-ui/src");
        const source = ["ServiceRecordWizard.tsx", "form-definition.ts", "types.ts", "index.ts"]
            .map((fileName) => readFileSync(resolve(packageSourceRoot, fileName), "utf8"))
            .join("\n");

        expect(source).not.toMatch(/(?:next\/navigation|@\/|\/api\/|@sentry|sessionStorage|localStorage|\bfetch\s*\()/);
    });
});
