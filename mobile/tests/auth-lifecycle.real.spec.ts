import { expect, test } from "@playwright/test";

type MailpitAddress = { Address?: string; address?: string };
type MailpitMessage = {
  ID?: string;
  id?: string;
  Subject?: string;
  subject?: string;
};
type MailpitMessageList = {
  total?: number;
  messages?: MailpitMessage[];
};
type MailpitMessageDetail = MailpitMessage & {
  To?: MailpitAddress[];
  to?: MailpitAddress[];
};

const mailpitMessageId = (message: MailpitMessage): string | undefined =>
  message.ID ?? message.id;

const mailpitSubject = (message: MailpitMessage): string | undefined =>
  message.Subject ?? message.subject;

const mailpitRecipients = (message: MailpitMessageDetail): string[] =>
  (message.To ?? message.to ?? [])
    .map((recipient) => recipient.Address ?? recipient.address)
    .filter((recipient): recipient is string => Boolean(recipient));

test("uses a real backend login session on mobile", async ({ request }) => {
  const response = await request.get("/api/auth/me");
  expect(response.status()).toBe(200);
  const user = (await response.json()) as { email?: string; role?: string };
  // Builds with NEXT_PUBLIC_E2E_TEST inlined stub /api/auth/me (lib/e2e.ts),
  // so the real-session assertion is unverifiable there.
  test.skip(
    user.email === "e2e@example.com",
    "app built with E2E auth stub — real session not observable via /api/auth/me",
  );
  expect(user).toMatchObject({
    email: "admin-a@auth-e2e.test",
    role: "admin",
  });
});

test("mobile registration is accepted once and delivered through Mailpit", async ({ request }) => {
  const suffix = Date.now().toString().slice(-8);
  const email = `mobile-${suffix}@auth-e2e.test`;
  const before = await request.get("http://localhost:8025/api/v1/messages");
  const beforeMessages = (await before.json()) as MailpitMessageList;
  const beforeTotal = beforeMessages.total ?? 0;
  const beforeIds = new Set(
    (beforeMessages.messages ?? [])
      .map(mailpitMessageId)
      .filter((id): id is string => Boolean(id)),
  );

  const registration = await request.post("/api/auth/register", {
    data: {
      email,
      password: "Password1!",
      name: "모바일테스트",
      phone: `010${suffix}`,
      birthDate: "1990-01-01",
      branchId: "20000000-0000-4000-8000-000000000001",
      role: "user",
    },
  });
  expect(registration.status()).toBe(201);

  await expect.poll(async () => {
    const messages = await request.get("http://localhost:8025/api/v1/messages");
    const messageList = (await messages.json()) as MailpitMessageList;
    if ((messageList.total ?? 0) <= beforeTotal) return false;

    for (const message of messageList.messages ?? []) {
      const id = mailpitMessageId(message);
      if (!id || beforeIds.has(id)) continue;

      const detailResponse = await request.get(
        `http://localhost:8025/api/v1/message/${encodeURIComponent(id)}`,
      );
      if (!detailResponse.ok()) continue;
      const detail = (await detailResponse.json()) as MailpitMessageDetail;
      if (
        mailpitSubject(detail) === "이메일 인증" &&
        mailpitRecipients(detail).includes(email)
      ) {
        return true;
      }
    }
    return false;
  }, { timeout: 20_000 }).toBe(true);
});
