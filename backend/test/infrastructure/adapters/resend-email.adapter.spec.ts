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

    describe("server logs keep recipient addresses unmasked", () => {
        const to = "member@example.com";

        afterEach(() => {
            jest.restoreAllMocks();
        });

        it("logs the plain recipient when no API key is configured (send and template)", async () => {
            delete process.env["RESEND_API_KEY"];
            const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
            const adapter = new ResendEmailAdapter();

            await expect(adapter.send({ to, subject: "제목", text: "본문", html: "<p>본문</p>" })).rejects.toBeDefined();
            await expect(adapter.sendVerificationEmail(to, "Member", "https://example.com/verify")).rejects.toBeDefined();

            expect(warnSpy).toHaveBeenCalledWith(`Email not sent (no API key): to=${to}, subject=제목`);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`Email not sent (no API key): to=${to}, template=`));
        });

        it("logs the plain recipient on success and failure (send and template)", async () => {
            process.env["RESEND_API_KEY"] = "test-key";
            const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
            const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
            const adapter = new ResendEmailAdapter();

            mockResendSend.mockResolvedValueOnce({ data: { id: "id-1" }, error: null });
            await adapter.send({ to, subject: "제목", text: "본문", html: "<p>본문</p>" });
            expect(logSpy).toHaveBeenCalledWith(`Email sent successfully to ${to}, ID: id-1`);

            mockResendSend.mockResolvedValueOnce({ data: { id: "id-2" }, error: null });
            await adapter.sendVerificationEmail(to, "Member", "https://example.com/verify");
            expect(logSpy).toHaveBeenCalledWith(`Template email sent to ${to}, ID: id-2`);

            const failure = new Error("boom");
            mockResendSend.mockRejectedValueOnce(failure);
            await expect(adapter.send({ to, subject: "제목", text: "본문", html: "<p>본문</p>" })).rejects.toBeDefined();
            expect(errorSpy).toHaveBeenCalledWith(`Failed to send email to ${to}:`, failure);

            mockResendSend.mockRejectedValueOnce(failure);
            await expect(adapter.sendVerificationEmail(to, "Member", "https://example.com/verify")).rejects.toBeDefined();
            expect(errorSpy).toHaveBeenCalledWith(`Failed to send template email to ${to}:`, failure);
        });
    });
});
