import { SmtpEmailAdapter } from "infrastructure/adapters/smtp-email.adapter";

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn((options: unknown) => {
    void options;
    return { sendMail: mockSendMail };
});

jest.mock("nodemailer", () => ({
    __esModule: true,
    default: {
        createTransport: (options: unknown) => mockCreateTransport(options),
    },
}));

describe("SmtpEmailAdapter", () => {
    const originalEnv = {
        SMTP_HOST: process.env["SMTP_HOST"],
        SMTP_PORT: process.env["SMTP_PORT"],
        SMTP_SECURE: process.env["SMTP_SECURE"],
        SMTP_USER: process.env["SMTP_USER"],
        SMTP_PASSWORD: process.env["SMTP_PASSWORD"],
        SMTP_FROM_EMAIL: process.env["SMTP_FROM_EMAIL"],
    };

    afterEach(() => {
        jest.clearAllMocks();
        for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    it("creates the configured transport and sends to the requested recipient and subject", async () => {
        process.env["SMTP_HOST"] = "mailpit";
        process.env["SMTP_PORT"] = "1025";
        process.env["SMTP_SECURE"] = "false";
        process.env["SMTP_FROM_EMAIL"] = "sender@example.com";
        mockSendMail.mockResolvedValue({ messageId: "smtp-message-1" });

        const adapter = new SmtpEmailAdapter();

        expect(mockCreateTransport).toHaveBeenCalledWith({
            host: "mailpit",
            port: 1025,
            secure: false,
            auth: undefined,
        });

        await expect(adapter.send({
            to: "recipient@example.com",
            subject: "이메일 인증",
            text: "인증 링크",
            html: "<p>인증 링크</p>",
        })).resolves.toBe("smtp-message-1");

        expect(mockSendMail).toHaveBeenCalledWith({
            from: "아가잼잼 어드민 <sender@example.com>",
            to: "recipient@example.com",
            subject: "이메일 인증",
            text: "인증 링크",
            html: "<p>인증 링크</p>",
        });
    });
});
