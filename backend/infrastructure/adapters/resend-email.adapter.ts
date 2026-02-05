import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { EmailPort, EmailOptions } from '../../domain/ports/email.port';

@Injectable()
export class ResendEmailAdapter implements EmailPort {
    private readonly resend: Resend | null;
    private readonly fromEmail: string;
    private readonly logger = new Logger(ResendEmailAdapter.name);

    constructor() {
        const apiKey = process.env['RESEND_API_KEY'];
        if (!apiKey) {
            this.logger.warn('RESEND_API_KEY not configured. Email sending will be disabled.');
            this.resend = null;
        } else {
            this.resend = new Resend(apiKey);
        }
        this.fromEmail = process.env['RESEND_FROM_EMAIL'] || 'noreply@example.com';
    }

    async send(options: EmailOptions): Promise<string> {
        if (!this.resend) {
            this.logger.warn(`Email not sent (no API key): to=${options.to}, subject=${options.subject}`);
            return 'disabled';
        }

        try {
            const response = await this.resend.emails.send({
                from: this.fromEmail,
                to: options.to,
                subject: options.subject,
                html: options.html,
                text: options.text,
            });

            if (response.error) {
                this.logger.error(`Failed to send email: ${response.error.message}`);
                throw new Error(response.error.message);
            }

            this.logger.log(`Email sent successfully to ${options.to}, ID: ${response.data?.id}`);
            return response.data?.id || '';
        } catch (error) {
            this.logger.error(`Failed to send email to ${options.to}:`, error);
            throw error;
        }
    }

    async sendVerificationEmail(
        to: string,
        name: string | null,
        verificationUrl: string,
    ): Promise<string> {
        const displayName = name || 'User';
        const subject = '이메일 인증을 완료해주세요';

        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">이메일 인증</h1>
    </div>
    <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
        <p style="font-size: 16px; margin-bottom: 20px;">안녕하세요, ${displayName}님!</p>
        <p style="font-size: 16px; margin-bottom: 20px;">회원가입을 완료하기 위해 아래 버튼을 클릭하여 이메일 주소를 인증해주세요.</p>
        <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold; display: inline-block;">이메일 인증하기</a>
        </div>
        <p style="font-size: 14px; color: #666; margin-top: 30px;">버튼이 작동하지 않는 경우, 아래 링크를 복사하여 브라우저에 붙여넣기 해주세요:</p>
        <p style="font-size: 12px; color: #888; word-break: break-all; background: #f5f5f5; padding: 10px; border-radius: 5px;">${verificationUrl}</p>
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
        <p style="font-size: 12px; color: #999; text-align: center;">이 인증 링크는 24시간 후에 만료됩니다.</p>
        <p style="font-size: 12px; color: #999; text-align: center;">본인이 회원가입을 요청하지 않으셨다면, 이 이메일을 무시해주세요.</p>
    </div>
</body>
</html>`;

        const text = `안녕하세요, ${displayName}님!

회원가입을 완료하기 위해 아래 링크를 클릭하여 이메일 주소를 인증해주세요.

인증 링크: ${verificationUrl}

이 인증 링크는 24시간 후에 만료됩니다.

본인이 회원가입을 요청하지 않으셨다면, 이 이메일을 무시해주세요.`;

        return this.send({ to, subject, html, text });
    }

    async sendPasswordResetEmail(
        to: string,
        name: string | null,
        resetUrl: string,
    ): Promise<string> {
        const displayName = name || 'User';
        const subject = '비밀번호 재설정 요청';

        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">비밀번호 재설정</h1>
    </div>
    <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
        <p style="font-size: 16px; margin-bottom: 20px;">안녕하세요, ${displayName}님!</p>
        <p style="font-size: 16px; margin-bottom: 20px;">비밀번호 재설정 요청을 받았습니다. 아래 버튼을 클릭하여 새 비밀번호를 설정해주세요.</p>
        <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 14px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold; display: inline-block;">비밀번호 재설정</a>
        </div>
        <p style="font-size: 14px; color: #666; margin-top: 30px;">버튼이 작동하지 않는 경우, 아래 링크를 복사하여 브라우저에 붙여넣기 해주세요:</p>
        <p style="font-size: 12px; color: #888; word-break: break-all; background: #f5f5f5; padding: 10px; border-radius: 5px;">${resetUrl}</p>
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
        <p style="font-size: 12px; color: #999; text-align: center;">이 링크는 1시간 후에 만료됩니다.</p>
        <p style="font-size: 12px; color: #999; text-align: center;">본인이 비밀번호 재설정을 요청하지 않으셨다면, 이 이메일을 무시해주세요. 계정은 안전합니다.</p>
    </div>
</body>
</html>`;

        const text = `안녕하세요, ${displayName}님!

비밀번호 재설정 요청을 받았습니다. 아래 링크를 클릭하여 새 비밀번호를 설정해주세요.

재설정 링크: ${resetUrl}

이 링크는 1시간 후에 만료됩니다.

본인이 비밀번호 재설정을 요청하지 않으셨다면, 이 이메일을 무시해주세요. 계정은 안전합니다.`;

        return this.send({ to, subject, html, text });
    }
}
