import { Resend } from "resend";
import { render } from "@react-email/components";
import VerificationEmail from "./verification-email";

const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!RESEND_API_KEY) {
  console.error("RESEND_API_KEY environment variable is required.");
  console.error("Usage: RESEND_API_KEY=re_xxx npx tsx src/emails/publish-verification-template.ts");
  process.exit(1);
}

async function publishTemplate() {
  const resend = new Resend(RESEND_API_KEY);

  const PLACEHOLDER_NAME = "___RESEND_NAME___";
  const PLACEHOLDER_URL = "___RESEND_VERIFICATION_URL___";
  const PLACEHOLDER_EXPIRY = "___RESEND_EXPIRY___";

  const html = await render(
    VerificationEmail({
      name: PLACEHOLDER_NAME,
      verificationUrl: PLACEHOLDER_URL,
      expiryHours: parseInt(PLACEHOLDER_EXPIRY) || 24,
    })
  );

  const templateHtml = html
    .replaceAll(PLACEHOLDER_NAME, "{{{NAME}}}")
    .replaceAll(PLACEHOLDER_URL, "{{{VERIFICATION_URL}}}")
    .replaceAll(PLACEHOLDER_EXPIRY, "{{{EXPIRY_HOURS}}}");

  console.log("Creating template...");

  const { data: created, error: createError } = await resend.templates.create({
    name: "email-verification",
    subject: "아가잼잼 - 이메일 인증을 완료해 주세요",
    html: templateHtml,
    variables: [
      {
        key: "NAME",
        type: "string",
        fallbackValue: "사용자",
      },
      {
        key: "VERIFICATION_URL",
        type: "string",
        fallbackValue: "https://admin.agajamjam.com/verify-email",
      },
      {
        key: "EXPIRY_HOURS",
        type: "number",
        fallbackValue: 24,
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
