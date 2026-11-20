"use client";
import { useState } from "react";
import { FieldLabelRow, fieldMessageId } from "@/components/app/ui/FieldLabelRow";
import { ButtonLoadingContent } from "@/components/ui/button";
import { useFieldMessages } from "@/hooks/use-field-messages";
import { useLocale } from "@/providers/LocaleProvider";
import "@/components/app/mobile-redesign/redesign.css";

interface Props {
  embedded?: boolean;
  onVerify(code: string): Promise<{ success: boolean; error?: string }>;
  onRestart(): void;
  "data-component": string;
}
export function LinkVerificationStep({ onVerify, onRestart, embedded = false, "data-component": base }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const messages = useFieldMessages({ values: { code }, specs: { code: { kind: "text", label: "인증번호", required: true } }, locale: useLocale() });
  const id = `${base}-code`;
  return <div className={embedded ? undefined : "auth-page"} data-slot="link-verification-step" data-component={base} data-source-component="LinkVerificationStep">
    <p className="auth-sub" data-slot="auth-sub">입력하신 정보와 일치하는 기존 계정이 있으면 문자로 인증번호를 보내드려요. 5분 안에 입력해 주세요.</p>
    <form className="auth-form" data-slot="auth-form" onSubmit={async event => {
      event.preventDefault();
      if (loading) return;
      messages.markSubmitted();
      if (!/^\d{6}$/.test(code)) { setError("인증번호 6자리를 입력해 주세요."); return; }
      setLoading(true);
      try {
        const result = await onVerify(code);
        if (!result.success) setError(result.error || "인증번호를 확인하지 못했습니다.");
      } catch { setError("인증번호를 확인하지 못했습니다."); }
      finally { setLoading(false); }
    }}>
      <div className="auth-input-group" data-slot="auth-input-group">
        <FieldLabelRow data-component={`${base}_code-field`} htmlFor={id} label="인증번호" message={error ? { text: error, tone: "err" } : null} />
        <input id={id} className="auth-input" data-slot="auth-input" inputMode="numeric" maxLength={6} autoComplete="one-time-code" placeholder="6자리 숫자"
          value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(undefined); }} {...messages.bind("code")}
          aria-invalid={Boolean(error)} aria-describedby={fieldMessageId(id)} />
      </div>
      <button className={loading ? "auth-btn relative" : "auth-btn"} data-slot="auth-btn" type="submit" disabled={loading} aria-busy={loading || undefined} data-loading={loading ? "" : undefined}>
        <ButtonLoadingContent loading={loading} loadingLabel="인증 중">인증하고 계정 연결</ButtonLoadingContent>
      </button>
      <button className="auth-btn secondary" data-slot="auth-btn" type="button" disabled={loading} onClick={onRestart}>정보 다시 입력</button>
    </form>
    <p className="auth-sub" data-slot="auth-sub">문자가 오지 않으면 입력한 전화번호와 생년월일을 확인한 뒤 다시 시도해 주세요.</p>
  </div>;
}
