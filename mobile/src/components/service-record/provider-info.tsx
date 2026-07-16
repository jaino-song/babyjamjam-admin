export const DEFAULT_PROVIDER_NAME = "인천 아이미래로";

interface ProviderInfoProps {
    providerName?: string;
}

export function ProviderInfo({ providerName = DEFAULT_PROVIDER_NAME }: ProviderInfoProps) {
    return (
        <div data-component="service-record-provider-name" className="org">
            {providerName}
        </div>
    );
}
