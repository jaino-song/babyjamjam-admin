import { Resend } from "resend";
import { render } from "@react-email/components";
import ResetPasswordEmail from "./reset-password-email";

const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!RESEND_API_KEY) {
  console.error("RESEND_API_KEY environment variable is required.");
  process.exit(1);
}

async function publishTemplate() {
  const resend = new Resend(RESEND_API_KEY);

  const PLACEHOLDER_NAME = "___RESEND_NAME___";
  const PLACEHOLDER_URL = "___RESEND_RESET_URL___";
  const PLACEHOLDER_EXPIRY = "___RESEND_EXPIRY___";

  const html = await render(
    ResetPasswordEmail({
      name: PLACEHOLDER_NAME,
      resetUrl: PLACEHOLDER_URL,
      expiryHours: parseInt(PLACEHOLDER_EXPIRY) || 1,
    })
  );

  const templateHtml = html
    .replaceAll(PLACEHOLDER_NAME, "{{{NAME}}}")
    .replaceAll(PLACEHOLDER_URL, "{{{RESET_URL}}}")
    .replaceAll(PLACEHOLDER_EXPIRY, "{{{EXPIRY_HOURS}}}");

  console.log("Creating template...");

  const { data: created, error: createError } = await resend.templates.create({
    name: "password-reset",
    subject: "아가잼잼 - 비밀번호 재설정",
    html: templateHtml,
    variables: [
      {
        key: "NAME",
        type: "string",
        fallbackValue: "사용자",
      },
      {
        key: "RESET_URL",
        type: "string",
        fallbackValue: "https://admin.agajamjam.com/reset-password",
      },
      {
        key: "EXPIRY_HOURS",
        type: "number",
        fallbackValue: 1,
      },
    ],
  });

  if (createError) {
    console.error("Failed to create template:", createError);
    process.exit(1);
  }

  console.log("Template created:", created);
  console.log("Publishing template...");

  const { data: published, error: publishError } =
    await resend.templates.publish(created!.id);

  if (publishError) {
    console.error("Failed to publish template:", publishError);
    process.exit(1);
  }

  console.log("Template published:", published);
  console.log(`\nTemplate ID: ${created!.id}`);
  console.log("Status: Published");
}

publishTemplate();
