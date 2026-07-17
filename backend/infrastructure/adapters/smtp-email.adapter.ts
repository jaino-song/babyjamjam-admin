import { Injectable, Logger } from "@nestjs/common";
import nodemailer, { Transporter } from "nodemailer";

import {
    EmailOptions,
    EmailPort,
    NotificationEmailOptions,
} from "domain/ports/email.port";
import { maskEmail } from "application/utils/mask";

@Injectable()
export class SmtpEmailAdapter implements EmailPort {
    private readonly logger = new Logger(SmtpEmailAdapter.name);
    private readonly transporter: Transporter;
    private readonly from: string;

    constructor() {
        this.transporter = nodemailer.createTransport({
            host: process.env["SMTP_HOST"] || "127.0.0.1",
            port: Number(process.env["SMTP_PORT"] || 1025),
            secure: process.env["SMTP_SECURE"] === "true",
            auth: process.env["SMTP_USER"]
                ? {
                    user: process.env["SMTP_USER"],
                    pass: process.env["SMTP_PASSWORD"] || "",
                }
                : undefined,
        });
        this.from = process.env["SMTP_FROM_EMAIL"] || "admin@babyjamjam.local";
    }

    async send(options: EmailOptions): Promise<string> {
        const result = await this.transporter.sendMail({
            from: this.from,
            ...options,
        });
        this.logger.log(`SMTP email sent to ${maskEmail(options.to)}`);
        return result.messageId;
    }

    sendVerificationEmail(
        to: string,
        name: string | null,
        verificationUrl: string,
    ): Promise<string> {
        return this.send({
            to,
            subject: "이메일 인증",
            text: `${name || "사용자"}님, 이메일 인증을 완료해 주세요: ${verificationUrl}`,
            html: `<p>${this.escape(name || "사용자")}님, 이메일 인증을 완료해 주세요.</p><p><a href="${this.escape(verificationUrl)}">이메일 인증</a></p>`,
        });
    }

    sendPasswordResetEmail(
        to: string,
        name: string | null,
        resetUrl: string,
    ): Promise<string> {
        return this.send({
            to,
            subject: "비밀번호 재설정",
            text: `${name || "사용자"}님, 비밀번호를 재설정해 주세요: ${resetUrl}`,
            html: `<p>${this.escape(name || "사용자")}님, 비밀번호를 재설정해 주세요.</p><p><a href="${this.escape(resetUrl)}">비밀번호 재설정</a></p>`,
        });
    }

    sendNotificationEmail(options: NotificationEmailOptions): Promise<string> {
        return this.send({
            to: options.to,
            subject: options.title,
            text: `${options.body}\n${options.ctaLabel}: ${options.ctaUrl}`,
            html: `<h1>${this.escape(options.title)}</h1><p>${this.escape(options.body)}</p><p><a href="${this.escape(options.ctaUrl)}">${this.escape(options.ctaLabel)}</a></p>`,
        });
    }

    private escape(value: string): string {
        return value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;");
    }
}
