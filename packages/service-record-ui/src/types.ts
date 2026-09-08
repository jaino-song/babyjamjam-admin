import type { ReactNode } from "react";

export type ServiceRecordScreen = "loading" | "invalid" | "phone" | "service" | "overview" | "day" | "done";

export interface ServiceRecordSession {
    sessionIndex: number;
    serviceDate: string;
    locked: boolean;
    submittedAt?: string | null;
    updatedAt?: string;
    answers?: Record<string, unknown>;
    etcService?: string | null;
    notes?: string | null;
    paymentConfirmed?: boolean;
    hasMomApproval?: boolean;
    employeeId?: number | null;
    employeeName?: string | null;
    momApproval?: string | null;
    clientSignature?: string | null;
    clientSignedAt?: string | null;
}

export interface ServiceRecordContext {
    org?: { name: string };
    employee?: { id: number; name: string };
    client?: { id: number; name: string };
    totalSessions: number;
    startDate: string | null;
    header: Record<string, unknown> | null;
    sessions: ServiceRecordSession[];
    recordStatus?: string | null;
    pendingScheduleChange?: {
        id: string;
        sessionIndex: number;
        fromDate: string;
        toDate: string;
    } | null;
}

export interface ScheduleChangePreview {
    sessionIndex: number;
    fromDate: string;
    toDate: string;
}

export interface PendingServiceDate {
    next: string;
    shift: number;
}

export interface ProviderSlotProps {
    "data-component": string;
    providerName?: string;
}

export interface SignatureSlotProps {
    "data-component": string;
    value: string | null;
    signedAt: string | null;
    onChange: (dataUri: string | null) => void;
    locked: boolean;
}

export interface ServiceRecordWizardSlots {
    provider?: (props: ProviderSlotProps) => ReactNode;
    signature?: (props: SignatureSlotProps) => ReactNode;
    /** Optional authenticated administrator controls. Public flows do not render this slot. */
    adminToolbar?: ReactNode;
    overviewSupplemental?: ReactNode;
    submitModal?: ReactNode;
    scheduleChangeModal?: ReactNode;
    serviceDateChangeModal?: ReactNode;
    errorNotification?: ReactNode;
}

export interface ServiceRecordWizardProps {
    "data-component": string;
    screen: ServiceRecordScreen;
    phone: string;
    phoneError: string | null;
    context: ServiceRecordContext | null;
    header: Record<string, string>;
    day: number;
    pageIdx: number;
    draft: Record<string, unknown>;
    editing: boolean;
    /**
     * Presentation-only mode for authenticated administration.  It keeps
     * the public wizard defaults unchanged while making every form control
     * read-only and every recorded session navigable.
     */
    readOnly?: boolean;
    /** Explicit opt-in for the authenticated administrator editor. */
    adminMode?: boolean;
    /** Session indexes whose values differ from the source record in a draft. */
    changedSessionIndexes?: ReadonlySet<number>;
    clientSignature: string | null;
    busy: boolean;
    isRecordFinalized: boolean;
    lockedDays: ReadonlySet<number>;
    nextOpenDay: () => number;
    scheduleChangeBusy: boolean;
    hasServiceDateMismatch: boolean;
    defaultDate: (day: number) => string;
    onPhoneChange: (value: string) => void;
    onSubmitPhone: () => void | Promise<void>;
    onBack: () => void;
    onHeaderChange: (key: string, value: string) => void;
    onDeliveryTypeChange: (value: string) => void;
    onSaveHeader: () => void | Promise<void>;
    onOpenDay: (day: number, editExisting?: boolean) => void;
    onOpenScheduleChangePreview: () => void | Promise<void>;
    onServiceDateChange: (next: string) => void;
    onFieldChange: (key: string, value: unknown) => void;
    onToggleMulti: (key: string, option: string) => void;
    onSignatureChange: (dataUri: string | null) => void;
    onNextPage: () => void;
    onOpenSubmitModal: () => void;
    onEditSection: (sectionIndex: number) => void;
    slots?: ServiceRecordWizardSlots;
}
