import { CAPABILITY_CATALOG_BY_NAME } from "./capability-catalog";
import { ExtendedReadAgentCapabilitiesProvider } from "./extended-read-agent-capabilities.provider";
import { ClientAgentCapabilitiesProvider } from "application/usecases/client/client-agent-capabilities.provider";
import { EmployeeAgentCapabilitiesProvider } from "application/usecases/employee/employee-agent-capabilities.provider";
import { EmployeeScheduleAgentCapabilitiesProvider } from "application/usecases/employee-schedule/employee-schedule-agent-capabilities.provider";
import { DashboardAgentCapabilitiesProvider } from "application/usecases/client/dashboard-agent-capabilities.provider";
import { EformsignAgentCapabilitiesProvider } from "application/usecases/eformsign-doc/eformsign-agent-capabilities.provider";
import { VoucherAgentCapabilitiesProvider } from "application/usecases/voucher-price-info/voucher-agent-capabilities.provider";
import { BankAccountAgentCapabilitiesProvider } from "application/usecases/bank-account-info/bank-account-agent-capabilities.provider";
import type { AgentCapabilityProviderContract } from "./capability.types";

describe("capability catalog", () => {
    it("keeps voucher pricing restricted to its provider roles", () => {
        expect(CAPABILITY_CATALOG_BY_NAME.get("vouchers.prices")?.requiredRoles).toEqual(["owner", "admin", "manager"]);
    });

    it("agrees with every real provider's own meta.description for all read capabilities", () => {
        // The registry always prefers the catalog description over a
        // provider's declared one (capability-registry.service.ts), so a
        // provider whose own literal drifts from the catalog would silently
        // never reach the model. Constructing the real providers here (with
        // stubbed constructor dependencies — getCapabilities() never touches
        // them) and comparing their declared descriptions against the
        // catalog keeps the two from ever disagreeing unnoticed.
        const stub = () => jest.fn() as never;
        const providers: AgentCapabilityProviderContract[] = [
            new ClientAgentCapabilitiesProvider(stub(), stub()),
            new EmployeeAgentCapabilitiesProvider(stub(), stub()),
            new EmployeeScheduleAgentCapabilitiesProvider(stub(), stub(), stub()),
            new DashboardAgentCapabilitiesProvider(stub()),
            new EformsignAgentCapabilitiesProvider(stub()),
            new VoucherAgentCapabilitiesProvider(stub()),
            new BankAccountAgentCapabilitiesProvider(stub()),
            new ExtendedReadAgentCapabilitiesProvider(stub(), stub(), stub(), stub(), stub(), stub(), stub()),
        ];

        const readDefinitions = providers
            .flatMap((provider) => provider.getCapabilities())
            .filter((definition) => definition.meta.risk === "read");

        expect(readDefinitions.length).toBeGreaterThan(0);

        for (const definition of readDefinitions) {
            const catalogEntry = CAPABILITY_CATALOG_BY_NAME.get(definition.meta.name);
            expect(catalogEntry?.description).toBe(definition.meta.description);
        }
    });
});
