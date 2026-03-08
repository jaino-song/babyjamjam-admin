"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button, Input, Textarea, FormField } from "@/components/ui";
import { FORM_CONSTRAINTS } from "@/types/models";
import type { ConsultationRequest, ApiResponse, ConsultationResponseData } from "@/types/api";

interface ConsultationModalProps {
  open: boolean;
  onClose: () => void;
}

type FormState = "idle" | "submitting" | "success" | "error";

export function ConsultationModal({ open, onClose }: ConsultationModalProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [message, setMessage] = useState("");
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formState, setFormState] = useState<FormState>("idle");
  const [apiError, setApiError] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && formState !== "submitting") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, onClose, formState]);

  const validate = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (!name.trim() || name.length > FORM_CONSTRAINTS.name.max) {
      errs.name = "이름을 입력해 주세요.";
    }
    if (!FORM_CONSTRAINTS.phone.pattern.test(phone)) {
      errs.phone = "올바른 연락처 형식이 아닙니다.";
    }
    if (!privacyAgreed) {
      errs.privacy = "개인정보처리방침에 동의해 주세요.";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [name, phone, privacyAgreed]);

  const handleSubmit = async () => {
    if (!validate()) return;
    setFormState("submitting");
    setApiError("");

    const body: ConsultationRequest = {
      name: name.trim(),
      phone: phone.trim(),
      dueDate: dueDate || undefined,
      message: message.trim() || undefined,
      privacyAgreed: true,
    };

    try {
      const res = await fetch("/api/v1/consultation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: ApiResponse<ConsultationResponseData> = await res.json();
      if (data.success) {
        setFormState("success");
      } else {
        setApiError(data.error?.message ?? "오류가 발생했습니다.");
        setFormState("error");
      }
    } catch {
      setApiError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      setFormState("error");
    }
  };

  const handleClose = () => {
    if (formState === "submitting") return;
    setName("");
    setPhone("");
    setDueDate("");
    setMessage("");
    setPrivacyAgreed(false);
    setErrors({});
    setFormState("idle");
    setApiError("");
    onClose();
  };

  if (!open) return null;

  return (
    <div
      data-component="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && formState !== "submitting") handleClose();
      }}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "var(--color-bg-overlay)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        animation: "fadeIn 200ms var(--ease-out)",
        padding: "var(--space-4)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label="무료 상담 신청"
    >
      <div
        ref={modalRef}
        data-component="modal"
        className="consultation-modal"
        style={{
          background: "var(--color-neutral-0)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-xl)",
          width: "100%",
          maxWidth: "520px",
          maxHeight: "90vh",
          overflowY: "auto",
          animation: "fadeInScale var(--duration-normal) var(--ease-out)",
        }}
      >
        {/* Header */}
        <div
          data-component="modal-header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "var(--space-6) var(--space-6) 0",
          }}
        >
          <h2
            data-component="modal-header-title"
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "var(--text-xl)",
              fontWeight: "var(--font-bold)" as string,
              color: "var(--color-neutral-900)",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
            }}
          >
            {formState === "success" ? "상담 신청 완료" : <>&#128150; 무료 상담 신청</>}
          </h2>
          <button
            data-component="modal-header-close"
            aria-label="닫기"
            onClick={handleClose}
            disabled={formState === "submitting"}
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "var(--radius-full)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-neutral-500)",
              fontSize: "var(--text-xl)",
              opacity: formState === "submitting" ? 0.3 : 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div data-component="modal-body" style={{ padding: "var(--space-6)" }}>
          {formState === "submitting" && (
            <div style={{ textAlign: "center", padding: "var(--space-12) var(--space-4)" }}>
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  border: "4px solid var(--color-neutral-200)",
                  borderTopColor: "var(--color-primary-500)",
                  borderRadius: "50%",
                  margin: "0 auto var(--space-6)",
                  animation: "spin 0.8s linear infinite",
                }}
                aria-hidden="true"
              />
              <p style={{ fontSize: "var(--text-base)", color: "var(--color-neutral-600)" }}>
                상담 신청을 처리하고 있습니다...
              </p>
            </div>
          )}

          {formState === "success" && (
            <div style={{ textAlign: "center", padding: "var(--space-8) var(--space-4)" }}>
              <div
                style={{
                  width: "72px",
                  height: "72px",
                  margin: "0 auto var(--space-6)",
                  background: "var(--color-secondary-100)",
                  borderRadius: "var(--radius-full)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "36px",
                }}
                aria-hidden="true"
              >
                &#10003;
              </div>
              <h3
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: "var(--text-2xl)",
                  fontWeight: "var(--font-bold)" as string,
                  color: "var(--color-neutral-900)",
                  marginBottom: "var(--space-3)",
                }}
              >
                상담 신청이 완료되었습니다!
              </h3>
              <p
                style={{
                  fontSize: "var(--text-base)",
                  color: "var(--color-neutral-600)",
                  lineHeight: "var(--leading-relaxed)",
                  marginBottom: "var(--space-6)",
                }}
              >
                담당자가 확인 후 빠른 시일 내에 연락드리겠습니다.
                <br />
                보통 영업일 기준 1일 이내에 연락을 드립니다.
              </p>
            </div>
          )}

          {(formState === "idle" || formState === "error") && (
            <>
              <p
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--color-neutral-600)",
                  marginBottom: "var(--space-6)",
                  lineHeight: "var(--leading-relaxed)",
                }}
              >
                출산 예정일과 원하시는 서비스를 알려주시면, 맞춤 상담을 제공해 드립니다.
              </p>

              {apiError && (
                <div
                  role="alert"
                  style={{
                    padding: "var(--space-3) var(--space-4)",
                    background: "#FEF2F2",
                    border: "1px solid var(--color-error)",
                    borderRadius: "var(--radius-md)",
                    fontSize: "var(--text-sm)",
                    color: "var(--color-error)",
                    marginBottom: "var(--space-4)",
                  }}
                >
                  {apiError}
                </div>
              )}

              <form
                data-component="consultation-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSubmit();
                }}
                noValidate
              >
                <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
                  <FormField
                    label="이름"
                    required
                    error={errors.name}
                    htmlFor="modal-name"
                    dataComponent="consultation-form-field"
                  >
                    <Input
                      id="modal-name"
                      type="text"
                      placeholder="홍길동"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      error={!!errors.name}
                      dataComponent="consultation-form-field-input"
                      aria-required="true"
                    />
                  </FormField>
                  <FormField
                    label="연락처"
                    required
                    error={errors.phone}
                    htmlFor="modal-phone"
                    dataComponent="consultation-form-field"
                  >
                    <Input
                      id="modal-phone"
                      type="tel"
                      placeholder="010-1234-5678"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      error={!!errors.phone}
                      dataComponent="consultation-form-field-input"
                      aria-required="true"
                    />
                  </FormField>
                </div>
                <FormField
                  label="출산 예정일"
                  htmlFor="modal-due-date"
                  helperText="출산 후 서비스 시작 예정일도 괜찮습니다."
                  dataComponent="consultation-form-field"
                >
                  <Input
                    id="modal-due-date"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    dataComponent="consultation-form-field-input"
                  />
                </FormField>
                <FormField
                  label="추가 요청사항"
                  htmlFor="modal-message"
                  dataComponent="consultation-form-field"
                >
                  <Textarea
                    id="modal-message"
                    placeholder="궁금한 점이나 요청사항이 있으시면 자유롭게 작성해 주세요."
                    rows={3}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    dataComponent="consultation-form-field-input"
                  />
                </FormField>

                <div
                  data-component="consultation-form-consent"
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "var(--space-3)",
                    marginBottom: "var(--space-4)",
                  }}
                >
                  <input
                    type="checkbox"
                    id="modal-consent"
                    checked={privacyAgreed}
                    onChange={(e) => setPrivacyAgreed(e.target.checked)}
                    style={{
                      width: "18px",
                      height: "18px",
                      marginTop: "2px",
                      accentColor: "var(--color-primary-500)",
                      flexShrink: 0,
                    }}
                    aria-required="true"
                  />
                  <label
                    htmlFor="modal-consent"
                    style={{
                      fontSize: "var(--text-sm)",
                      color: "var(--color-neutral-600)",
                      lineHeight: "var(--leading-relaxed)",
                    }}
                  >
                    <a
                      href="/disclaimer"
                      target="_blank"
                      style={{
                        color: "var(--color-primary-500)",
                        textDecoration: "underline",
                      }}
                    >
                      개인정보처리방침
                    </a>
                    에 동의합니다.
                  </label>
                </div>
                {errors.privacy && (
                  <p
                    role="alert"
                    style={{
                      fontSize: "var(--text-xs)",
                      color: "var(--color-error)",
                      marginBottom: "var(--space-4)",
                      marginTop: "calc(-1 * var(--space-2))",
                    }}
                  >
                    {errors.privacy}
                  </p>
                )}
              </form>
            </>
          )}
        </div>

        {/* Footer */}
        {formState === "success" ? (
          <div
            data-component="modal-footer"
            style={{
              padding: "0 var(--space-6) var(--space-6)",
              display: "flex",
              justifyContent: "center",
            }}
          >
            <Button
              variant="primary"
              onClick={handleClose}
              dataComponent="modal-footer-confirm"
              style={{ minWidth: "200px" }}
            >
              확인
            </Button>
          </div>
        ) : formState !== "submitting" ? (
          <div
            data-component="modal-footer"
            style={{
              padding: "0 var(--space-6) var(--space-6)",
              display: "flex",
              gap: "var(--space-3)",
              justifyContent: "flex-end",
            }}
          >
            <Button
              variant="ghost"
              onClick={handleClose}
              dataComponent="modal-footer-cancel"
            >
              취소
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              dataComponent="modal-footer-submit"
              style={{ flex: 1 }}
            >
              상담 신청하기
            </Button>
          </div>
        ) : null}
      </div>

      <style>{`
        @media (max-width: 767px) {
          [data-component="modal-overlay"] {
            align-items: flex-end !important;
            padding: 0 !important;
          }
          .consultation-modal {
            max-height: 85vh !important;
            border-radius: var(--radius-lg) var(--radius-lg) 0 0 !important;
            animation: slideUp var(--duration-normal) var(--ease-out) !important;
          }
          .form-row {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
