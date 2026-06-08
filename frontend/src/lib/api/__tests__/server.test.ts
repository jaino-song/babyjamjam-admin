import { serverAPIClient } from "../server";

describe("serverAPIClient", () => {
    it("rejects backend error statuses so API routes preserve upstream failures", () => {
        const validateStatus = serverAPIClient.defaults.validateStatus;

        expect(validateStatus?.(200)).toBe(true);
        expect(validateStatus?.(399)).toBe(true);
        expect(validateStatus?.(400)).toBe(false);
        expect(validateStatus?.(500)).toBe(false);
    });
});
