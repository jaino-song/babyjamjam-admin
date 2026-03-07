import { Resend } from "resend";

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? "forchildrenbysongs@gmail.com";

interface SendContactEmailParams {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

interface SendConsultationEmailParams {
  name: string;
  phone: string;
  dueDate?: string;
  message?: string;
}

export async function sendContactEmail(params: SendContactEmailParams) {
  const { name, email, phone, subject, message } = params;

  await getResend().emails.send({
    from: "imirae-incheon.com <onboarding@resend.dev>",
    to: CONTACT_EMAIL,
    replyTo: email,
    subject: sanitizeHeader(`[웹사이트 문의] ${subject}`),
    html: `
      <h2>웹사이트 문의</h2>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:8px;font-weight:bold">이름</td><td style="padding:8px">${escapeHtml(name)}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">이메일</td><td style="padding:8px">${escapeHtml(email)}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">전화번호</td><td style="padding:8px">${escapeHtml(phone)}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">제목</td><td style="padding:8px">${escapeHtml(subject)}</td></tr>
      </table>
      <h3>내용</h3>
      <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
    `,
  });
}

export async function sendConsultationEmail(params: SendConsultationEmailParams) {
  const { name, phone, dueDate, message } = params;

  let body = `
    <h2>상담 신청</h2>
    <table style="border-collapse:collapse;width:100%">
      <tr><td style="padding:8px;font-weight:bold">이름</td><td style="padding:8px">${escapeHtml(name)}</td></tr>
      <tr><td style="padding:8px;font-weight:bold">전화번호</td><td style="padding:8px">${escapeHtml(phone)}</td></tr>
  `;

  if (dueDate) {
    body += `<tr><td style="padding:8px;font-weight:bold">출산 예정일</td><td style="padding:8px">${escapeHtml(dueDate)}</td></tr>`;
  }

  body += `</table>`;

  if (message) {
    body += `<h3>추가 메시지</h3><p style="white-space:pre-wrap">${escapeHtml(message)}</p>`;
  }

  await getResend().emails.send({
    from: "imirae-incheon.com <onboarding@resend.dev>",
    to: CONTACT_EMAIL,
    subject: sanitizeHeader(`[상담 신청] ${name}님`),
    html: body,
  });
}

function sanitizeHeader(str: string): string {
  return str.replace(/[\r\n]/g, "");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
