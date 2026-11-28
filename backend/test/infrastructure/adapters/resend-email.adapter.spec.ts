import { Logger } from "@nestjs/common";
import { ResendEmailAdapter } from "infrastructure/adapters/resend-email.adapter";

const mockResendSend = jest.fn();

jest.mock("resend", () => ({
    Resend: jest.fn().mockImplementation(() => ({
        emails: { send: mockResendSend },
    })),
}));

describe("ResendEmailAdapter idempotency", () => {
    const originalApiKey = process.env["RESEND_API_KEY"];
    const originalFrom = process.env["RESEND_FROM_EMAIL"];

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
        if (originalApiKey === undefined) delete process.env["RESEND_API_KEY"];
        else process.env["RESEND_API_KEY"] = originalApiKey;
        if (originalFrom === undefined) delete process.env["RESEND_FROM_EMAIL"];
        else process.env["RESEND_FROM_EMAIL"] = originalFrom;
    });

    it("passes the durable idempotency key to Resend", async () => {
        process.env["RESEND_API_KEY"] = "test-key";
        mockResendSend.mockResolvedValue({ data: { id: "resend-message-1" }, error: null });

        const adapter = new ResendEmailAdapter();
        await expect(adapter.sendVerificationEmail(
            "member@example.com",
            "Member",
            "https://example.com/verify",
            { idempotencyKey: "auth-email:stable-key" },
        )).resolves.toBe("resend-message-1");

        expect(mockResendSend).toHaveBeenCalledWith(
            expect.objectContaining({
                template: expect.objectContaining({ id: expect.any(String) }),
            }),
            { idempotencyKey: "auth-email:stable-key" },
        );
    });

    it("reports missing provider configuration as a retryable pre-send failure", async () => {
        delete process.env["RESEND_API_KEY"];

        const adapter = new ResendEmailAdapter();

        await expect(adapter.sendPasswordResetEmail(
            "member@example.com",
            "Member",
            "https://example.com/reset",
            { idempotencyKey: "auth-email:stable-key" },
        )).rejects.toMatchObject({
            name: "EmailProviderError",
            stage: "pre_send",
        });
    });

    it("blocks direct and template emails without calling Resend", async () => {
        jest.replaceProperty(process, "env", {
            ...process.env, RESEND_API_KEY: "test-key", EMAIL_RECIPIENT_ALLOWLIST: "allowed@example.test",
        });
        const to = "blocked@example.test";
        const adapter = new ResendEmailAdapter();
        await expect(adapter.send({ to, subject: "test", html: "test" })).rejects.toThrow(/^Blocked by staging recipient allowlist/);
        await expect(adapter.sendVerificationEmail(to, null, "https://example.test/verify"))
            .rejects.toThrow(/^Blocked by staging recipient allowlist/);
        await expect(adapter.sendPasswordResetEmail(to, null, "https://example.test/reset"))
            .rejects.toThrow(/^Blocked by staging recipient allowlist/);
        expect(mockResendSend).not.toHaveBeenCalled();
    });

    describe("server logs mask recipient addresses", () => {
        const to = "member@example.com";
        const masked = "***@example.com";

        afterEach(() => {
            jest.restoreAllMocks();
        });

        it("masks the recipient when no API key is configured (send and template)", async () => {
            delete process.env["RESEND_API_KEY"];
            const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
            const adapter = new ResendEmailAdapter();

            await expect(adapter.send({ to, subject: "제목", text: "본문", html: "<p>본문</p>" })).rejects.toBeDefined();
            await expect(adapter.sendVerificationEmail(to, "Member", "https://example.com/verify")).rejects.toBeDefined();

            expect(warnSpy).toHaveBeenCalledWith(`Email not sent (no API key): to=${masked}`);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`Email not sent (no API key): to=${masked}, template=`));
        });

        it("masks the recipient on success and failure (send and template)", async () => {
            process.env["RESEND_API_KEY"] = "test-key";
            const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
            const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
            const adapter = new ResendEmailAdapter();

            mockResendSend.mockResolvedValueOnce({ data: { id: "id-1" }, error: null });
            await adapter.send({ to, subject: "제목", text: "본문", html: "<p>본문</p>" });
            expect(logSpy).toHaveBeenCalledWith(`Email sent successfully to ${masked}, ID: id-1`);

            mockResendSend.mockResolvedValueOnce({ data: { id: "id-2" }, error: null });
            await adapter.sendVerificationEmail(to, "Member", "https://example.com/verify");
            expect(logSpy).toHaveBeenCalledWith(`Template email sent to ${masked}, ID: id-2`);

            const failure = new Error("boom");
            mockResendSend.mockRejectedValueOnce(failure);
            await expect(adapter.send({ to, subject: "제목", text: "본문", html: "<p>본문</p>" })).rejects.toBeDefined();
            expect(errorSpy).toHaveBeenCalledWith(`Failed to send email to ${masked}`);

            mockResendSend.mockRejectedValueOnce(failure);
            await expect(adapter.sendVerificationEmail(to, "Member", "https://example.com/verify")).rejects.toBeDefined();
            expect(errorSpy).toHaveBeenCalledWith(`Failed to send template email to ${masked}`);
        });

        it("logs the masked provider error for direct and template sends", async () => {
            process.env["RESEND_API_KEY"] = "test-key";
            const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
            const adapter = new ResendEmailAdapter();
            const failure = { data: null, error: { message: "Invalid recipient member@example.com or 010-1234-5678" } };

            mockResendSend.mockResolvedValueOnce(failure).mockResolvedValueOnce(failure);
            await expect(adapter.send({ to, subject: "test", html: "test" }))
                .rejects.toMatchObject({ message: "email_provider_unknown", stage: "unknown" });
            await expect(adapter.sendVerificationEmail(to, null, "https://example.com/verify"))
                .rejects.toMatchObject({ message: "email_provider_unknown", stage: "unknown" });

            const reason = "Invalid recipient ***@example.com or ***5678";
            expect(errorSpy.mock.calls).toEqual([
                [`Failed to send email to ${masked}: ${reason}`],
                [`Failed to send template email to ${masked}: ${reason}`],
            ]);
        });
    });
});
