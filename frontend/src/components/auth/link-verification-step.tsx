"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

interface LinkVerificationStepProps {
  onVerify: (code: string) => Promise<{ success: boolean; error?: string }>;
  onRestart: () => void;
  "data-component": string;
}

export function LinkVerificationStep({ onVerify, onRestart, "data-component": base }: LinkVerificationStepProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const errorId = useId();
  const codeInputRef = useRef<HTMLInputElement>(null);
  const [rejectedSubmitCount, setRejectedSubmitCount] = useState(0);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (rejectedSubmitCount > 0 && !pending && error) codeInputRef.current?.focus();
  }, [rejectedSubmitCount, pending, error]);
  return (
    <form data-component={base} data-source-component="LinkVerificationStep" className="flex flex-col gap-4" onSubmit={(event) => {
      event.preventDefault();
      if (!/^\d{6}$/.test(code)) {
        setError("인증번호 6자리를 입력해 주세요.");
        codeInputRef.current?.focus();
        return;
      }
      setError(undefined);
      startTransition(async () => {
        try {
          const result = await onVerify(code);
          if (!result.success) {
            setError(result.error || "계정 연결에 실패했어요. 다시 시도해 주세요.");
            setRejectedSubmitCount((count) => count + 1);
          }
        } catch {
          setError("계정 연결에 실패했어요. 다시 시도해 주세요.");
          setRejectedSubmitCount((count) => count + 1);
        }
      });
    }}>
      <p data-component={`${base}_explanation`}>입력하신 정보와 일치하는 기존 계정이 있으면 문자로 인증번호를 보내드려요. 5분 안에 입력해 주세요.</p>
      <FormField ref={codeInputRef} data-component={`${base}_code`} label="인증번호" placeholder="6자리 숫자" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} disabled={pending} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
      {error && <Alert id={errorId} data-component={`${base}_error`} variant="destructive">{error}</Alert>}
      <Button data-component={`${base}_verify`} type="submit" variant="positive" loading={pending}>인증하고 계정 연결</Button>
      <Button data-component={`${base}_restart`} type="button" variant="neutral" disabled={pending} onClick={onRestart}>정보 다시 입력</Button>
      <p data-component={`${base}_hint`}>문자가 오지 않으면 입력한 전화번호와 생년월일을 확인한 뒤 다시 시도해 주세요.</p>
    </form>
  );
}
