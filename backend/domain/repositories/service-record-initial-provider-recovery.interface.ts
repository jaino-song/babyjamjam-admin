/** Provider recovery runs under the existing reconcile lease; it never creates documents. */
export interface IInitialProviderRecovery {
    reconcile(options?: { branchId?: string; shouldContinue?: () => boolean }, now?: Date): Promise<number>;
}
export const INITIAL_PROVIDER_RECOVERY = "INITIAL_PROVIDER_RECOVERY";
