"use client";

import { useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ChevronLeft, Send } from "lucide-react";
import { ContentPaper } from "@/components/app/root/content-paper";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api/client";

interface SendResponse {
  result?: string;
  message?: string;
}

const PHONE_REGEX = /^[0-9,\-\s]+$/;
const MAX_BODY = 2000;
const MAX_TITLE = 44;

function normalizePhone(raw: string) {
  return raw.replace(/[^0-9\-,]/g, "");
}

export default function NewMessagePage() {
  const router = useRouter();
  const [receiver, setReceiver] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const validationError = useMemo(() => {
    if (!receiver.trim()) return "수신자 연락처를 입력해 주세요.";
    if (!PHONE_REGEX.test(receiver.trim())) return "수신자 연락처 형식이 올바르지 않습니다. (숫자, '-', ',' 만 허용)";
    if (!body.trim()) return "메시지 본문을 입력해 주세요.";
    if (body.length > MAX_BODY) return `본문은 최대 ${MAX_BODY}자까지 입력할 수 있습니다.`;
    if (title.length > MAX_TITLE) return `제목은 최대 ${MAX_TITLE}자까지 입력할 수 있습니다.`;
    return null;
  }, [receiver, body, title]);

  const sendMutation = useMutation<SendResponse, unknown, void>({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        receiver: receiver.trim(),
        message: body.trim(),
        triggerType: "immediate",
      };
      if (title.trim()) payload.title = title.trim();
      if (recipientName.trim()) payload.recipientName = recipientName.trim();
      const res = await api.post<SendResponse>("/message-deliveries/sms", payload);
      return res.data;
    },
    onSuccess: () => {
      setErrorMessage(null);
      setSuccessMessage("메시지 발송 요청이 접수되었습니다.");
      setReceiver("");
      setRecipientName("");
      setTitle("");
      setBody("");
    },
    onError: (err) => {
      setSuccessMessage(null);
      if (isAxiosError<{ error?: string; message?: string | string[] }>(err)) {
        const data = err.response?.data;
        const msg = Array.isArray(data?.message) ? data?.message.join(", ") : data?.message;
        setErrorMessage(msg ?? data?.error ?? "발송에 실패했습니다.");
        return;
      }
      setErrorMessage("발송에 실패했습니다.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validationError || sendMutation.isPending) return;
    sendMutation.mutate();
  };

  return (
    <section data-component="messages-new-page" className="space-y-4 p-4">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="뒤로 가기"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-v3-border/60 bg-white hover:bg-v3-dim-white"
        >
          <ChevronLeft size={18} />
        </button>
        <div>
          <h1 className="text-lg font-bold text-v3-dark">새 메시지</h1>
          <p className="text-[0.78rem] text-v3-text-muted">SMS로 즉시 메시지를 발송합니다.</p>
        </div>
      </header>

      <ContentPaper variant="v3">
        <form data-component="messages-new-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="receiver" className="text-[0.78rem] font-semibold text-v3-dark">
              수신자 연락처 <span className="text-red-500">*</span>
            </label>
            <input
              id="receiver"
              type="tel"
              inputMode="numeric"
              placeholder="010-1234-5678"
              autoComplete="off"
              value={receiver}
              onChange={(e) => setReceiver(normalizePhone(e.target.value))}
              className="w-full rounded-2xl border border-v3-border/60 bg-white px-4 py-3 text-sm focus:border-v3-primary focus:outline-none"
            />
            <p className="text-[0.68rem] text-v3-text-muted">여러 명에게 발송하려면 쉼표(,)로 구분하세요.</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="recipientName" className="text-[0.78rem] font-semibold text-v3-dark">
              수신자 이름 (선택)
            </label>
            <input
              id="recipientName"
              type="text"
              placeholder="홍길동"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              className="w-full rounded-2xl border border-v3-border/60 bg-white px-4 py-3 text-sm focus:border-v3-primary focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="title" className="text-[0.78rem] font-semibold text-v3-dark">
              제목 (선택, LMS 전환 시 사용)
            </label>
            <input
              id="title"
              type="text"
              maxLength={MAX_TITLE}
              placeholder="(선택) 제목"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-2xl border border-v3-border/60 bg-white px-4 py-3 text-sm focus:border-v3-primary focus:outline-none"
            />
            <p className="text-right text-[0.68rem] text-v3-text-muted">
              {title.length} / {MAX_TITLE}
            </p>
          </div>

          <Separator />

          <div className="space-y-1.5">
            <label htmlFor="body" className="text-[0.78rem] font-semibold text-v3-dark">
              메시지 본문 <span className="text-red-500">*</span>
            </label>
            <textarea
              id="body"
              rows={6}
              maxLength={MAX_BODY}
              placeholder="발송할 메시지 내용을 입력하세요."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-2xl border border-v3-border/60 bg-white px-4 py-3 text-sm focus:border-v3-primary focus:outline-none resize-none"
            />
            <p className="text-right text-[0.68rem] text-v3-text-muted">
              {body.length} / {MAX_BODY}
            </p>
          </div>

          {validationError ? (
            <div
              data-component="messages-new-validation"
              className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-[0.78rem] text-amber-700"
            >
              {validationError}
            </div>
          ) : null}

          {errorMessage ? (
            <div
              data-component="messages-new-error"
              className="rounded-2xl border border-red-300 bg-red-50 p-3 text-[0.78rem] text-red-700"
            >
              {errorMessage}
            </div>
          ) : null}

          {successMessage ? (
            <div
              data-component="messages-new-success"
              className="rounded-2xl border border-emerald-300 bg-emerald-50 p-3 text-[0.78rem] text-emerald-700"
            >
              {successMessage}
            </div>
          ) : null}

          <button
            type="submit"
            data-component="messages-new-submit"
            disabled={!!validationError || sendMutation.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-v3-primary px-4 py-3 text-sm font-bold text-white shadow-v3-hover transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sendMutation.isPending ? (
              <>
                <Spinner className="h-4 w-4" /> 발송 중…
              </>
            ) : (
              <>
                <Send size={16} /> 즉시 발송
              </>
            )}
          </button>
        </form>
      </ContentPaper>
    </section>
  );
}
