"use client";

import type {
    ServiceRecordWizardProps,
    ServiceRecordWizardSlots,
} from "@babyjamjam/service-record-ui";
import { ServiceRecordWizard as SharedServiceRecordWizard } from "@babyjamjam/service-record-ui";

import { ProviderInfo, DEFAULT_PROVIDER_NAME } from "@/components/service-record/provider-info";

import { SignaturePad } from "./SignaturePad";

export type MobileServiceRecordWizardProps = Omit<ServiceRecordWizardProps, "slots"> & {
    slots?: Omit<ServiceRecordWizardSlots, "provider" | "signature">;
};

export function MobileServiceRecordWizard({
    "data-component": dataComponent,
    context,
    slots,
    ...props
}: MobileServiceRecordWizardProps) {
    return (
        <SharedServiceRecordWizard
            {...props}
            context={context}
            data-component={dataComponent}
            slots={{
                ...slots,
                provider: ({ "data-component": providerDataComponent, providerName }) => (
                    <ProviderInfo
                        data-component={providerDataComponent}
                        providerName={providerName ?? context?.org?.name ?? DEFAULT_PROVIDER_NAME}
                    />
                ),
                signature: (signatureProps) => <SignaturePad {...signatureProps} />,
            }}
        />
    );
}
