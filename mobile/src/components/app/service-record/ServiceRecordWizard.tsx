"use client";

import type {
    ServiceRecordWizardProps,
    ServiceRecordWizardSlots,
} from "@babyjamjam/service-record-ui";

import { MobileServiceRecordScreen } from "./screen/MobileServiceRecordScreen";

export type MobileServiceRecordWizardProps = Omit<ServiceRecordWizardProps, "slots"> & {
    slots?: Omit<ServiceRecordWizardSlots, "provider" | "signature">;
    /** Mobile-only muted line on the phone step, e.g. why the caregiver was sent back to verification. */
    phoneNotice?: string | null;
};

// Rollback: render the package's `ServiceRecordWizard` here again, with the `provider` / `signature` slots (ProviderInfo / SignaturePad).
/* eslint-disable @typescript-eslint/no-unused-vars -- the administrator-only props are destructured away on purpose, so they are never forwarded */
export function MobileServiceRecordWizard({
    adminMode: _adminMode,
    readOnly: _readOnly,
    headerErrors: _headerErrors,
    changedSessionIndexes: _changedSessionIndexes,
    onOpenServiceDateEditor: _onOpenServiceDateEditor,
    slots,
    ...props
}: MobileServiceRecordWizardProps) {
    /* eslint-enable @typescript-eslint/no-unused-vars */
    return (
        <MobileServiceRecordScreen
            {...props}
            slots={{
                submitModal: slots?.submitModal,
                scheduleChangeModal: slots?.scheduleChangeModal,
                serviceDateChangeModal: slots?.serviceDateChangeModal,
                errorNotification: slots?.errorNotification,
            }}
        />
    );
}
