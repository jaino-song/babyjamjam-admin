"use client";

import { useState, useCallback } from "react";
import { Button, Input, Textarea, FormField } from "@/components/ui";
import { COMPANY_INFO, FORM_CONSTRAINTS } from "@/types/models";
import type { ContactFormRequest, ApiResponse, ContactFormResponseData } from "@/types/api";

type FormState = "idle" | "submitting" | "success" | "error";

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formState, setFormState] = useState<FormState>("idle");
  const [apiError, setApiError] = useState("");

  const validate = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (!name.trim() || name.length > FORM_CONSTRAINTS.name.max) errs.name = "이름을 입력해 주세요.";
    if (!email.trim()) errs.email = "이메일을 입력해 주세요.";
    if (!FORM_CONSTRAINTS.phone.pattern.test(phone)) errs.phone = "올바른 연락처 형식이 아닙니다.";
    if (!subject) errs.subject = "문의 유형을 선택해 주세요.";
    if (!message.trim() || message.length > FORM_CONSTRAINTS.contactMessage.max) errs.message = "문의 내용을 입력해 주세요.";
    if (!privacyAgreed) errs.privacy = "개인정보처리방침에 동의해 주세요.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [name, email, phone, subject, message, privacyAgreed]);

  const handleSubmit = async () => {
    if (!validate()) return;
    setFormState("submitting");
    setApiError("");

    const body: ContactFormRequest = {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      subject: subject,
      message: message.trim(),
      privacyAgreed: true,
    };

    try {
      const res = await fetch("/api/v1/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: ApiResponse<ContactFormResponseData> = await res.json();
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

  const resetForm = () => {
    setName(""); setEmail(""); setPhone(""); setSubject(""); setMessage("");
    setPrivacyAgreed(false); setErrors({}); setFormState("idle"); setApiError("");
  };

  return (
    <>
      {/* Page Header */}
      <section data-component="contact-header" style={{ paddingTop: "calc(var(--nav-height) + var(--space-16))", paddingBottom: "var(--space-16)", background: "linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-bg-cream) 100%)", textAlign: "center" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <span data-component="contact-header-badge" style={{ display: "inline-flex", padding: "4px 12px", borderRadius: "var(--radius-full)", fontSize: "var(--text-xs)", fontWeight: "var(--font-medium)" as string, marginBottom: "var(--space-4)", background: "var(--color-primary-100)", color: "var(--color-primary-700)" }}>Contact</span>
          <h1 data-component="contact-header-title" className="page-header-title" style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-5xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", lineHeight: "var(--leading-tight)", marginBottom: "var(--space-4)" }}>문의하기</h1>
          <p data-component="contact-header-desc" style={{ fontSize: "var(--text-lg)", color: "var(--color-neutral-500)", maxWidth: "600px", margin: "0 auto", lineHeight: "var(--leading-relaxed)" }}>궁금한 점이 있으시면 언제든지 문의해 주세요. 친절하게 안내해 드리겠습니다.</p>
        </div>
      </section>

      {/* Contact Content */}
      <section data-component="contact" aria-label="문의" style={{ padding: "var(--space-20) 0", background: "var(--color-neutral-0)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div className="contact-layout" style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: "var(--space-12)" }}>
            {/* Contact Info Sidebar */}
            <div data-component="contact-info">
              <h2 style={{ fontSize: "var(--text-2xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", marginBottom: "var(--space-3)" }}>연락처 안내</h2>
              <p style={{ fontSize: "var(--text-base)", color: "var(--color-neutral-500)", lineHeight: "var(--leading-relaxed)", marginBottom: "var(--space-6)" }}>전화, 이메일, 방문 어떤 방법으로든 편하게 연락해 주세요.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)", marginBottom: "var(--space-8)" }}>
                {[
                  { component: "contact-info-phone", icon: "\u{1F4DE}", bg: "var(--color-primary-100)", title: "전화", content: <a href="tel:032-442-5992">{COMPANY_INFO.phone}</a> },
                  { component: "contact-info-fax", icon: "\u{1F4E0}", bg: "var(--color-secondary-100)", title: "팩스", content: COMPANY_INFO.fax },
                  { component: "contact-info-email", icon: "\u2709", bg: "var(--color-accent-100)", title: "이메일", content: <a href={`mailto:${COMPANY_INFO.email}`}>{COMPANY_INFO.email}</a> },
                  { component: "contact-info-address", icon: "\u{1F4CD}", bg: "var(--color-neutral-100)", title: "주소", content: <>인천광역시 남동구 구월남로 120<br />백세빌딩 302호</> },
                ].map((item) => (
                  <div key={item.component} data-component={item.component} style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
                    <div aria-hidden="true" style={{ width: "44px", height: "44px", borderRadius: "var(--radius-md)", background: item.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", flexShrink: 0 }}>{item.icon}</div>
                    <div>
                      <h4 style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-800)", marginBottom: "var(--space-1)" }}>{item.title}</h4>
                      <div style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", lineHeight: "var(--leading-relaxed)" }}>{item.content}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div data-component="contact-info-hours" style={{ background: "var(--color-neutral-50)", borderRadius: "var(--radius-md)", padding: "var(--space-5)" }}>
                <h4 style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-800)", marginBottom: "var(--space-3)" }}>상담 가능 시간</h4>
                {[
                  { day: "월요일 - 금요일", time: "09:00 - 18:00" },
                  { day: "토요일", time: "09:00 - 13:00" },
                  { day: "일요일 / 공휴일", time: "휴무", closed: true },
                ].map((row) => (
                  <div key={row.day} style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-sm)", padding: "var(--space-2) 0", color: row.closed ? "var(--color-neutral-400)" : "var(--color-neutral-600)" }}>
                    <span>{row.day}</span>
                    <span style={{ fontWeight: "var(--font-medium)" as string }}>{row.time}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Contact Form */}
            {formState === "success" ? (
              <div data-component="contact-form" style={{ background: "var(--color-bg-card)", borderRadius: "var(--radius-md)", padding: "var(--space-10)", boxShadow: "var(--shadow-sm)", textAlign: "center" }}>
                <div style={{ width: "72px", height: "72px", margin: "0 auto var(--space-6)", background: "var(--color-secondary-100)", borderRadius: "var(--radius-full)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "36px" }} aria-hidden="true">&#10003;</div>
                <h3 style={{ fontSize: "var(--text-2xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", marginBottom: "var(--space-3)" }}>문의가 접수되었습니다!</h3>
                <p style={{ fontSize: "var(--text-base)", color: "var(--color-neutral-600)", lineHeight: "var(--leading-relaxed)", marginBottom: "var(--space-6)" }}>담당자가 확인 후 빠른 시일 내에 답변드리겠습니다.</p>
                <Button variant="primary" onClick={resetForm}>새 문의 작성</Button>
              </div>
            ) : (
              <form
                data-component="contact-form"
                aria-label="문의 양식"
                noValidate
                onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
                style={{ background: "var(--color-bg-card)", borderRadius: "var(--radius-md)", padding: "var(--space-8)", boxShadow: "var(--shadow-sm)" }}
              >
                <h3 style={{ fontSize: "var(--text-xl)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-800)", marginBottom: "var(--space-6)" }}>문의 양식</h3>

                {apiError && (
                  <div role="alert" style={{ padding: "var(--space-3) var(--space-4)", background: "#FEF2F2", border: "1px solid var(--color-error)", borderRadius: "var(--radius-md)", fontSize: "var(--text-sm)", color: "var(--color-error)", marginBottom: "var(--space-4)" }}>{apiError}</div>
                )}

                <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
                  <FormField label="이름" required error={errors.name} htmlFor="contact-name" dataComponent="contact-form-field">
                    <Input id="contact-name" type="text" placeholder="홍길동" value={name} onChange={(e) => setName(e.target.value)} error={!!errors.name} dataComponent="contact-form-field-input" aria-required="true" />
                  </FormField>
                  <FormField label="연락처" required error={errors.phone} htmlFor="contact-phone" dataComponent="contact-form-field">
                    <Input id="contact-phone" type="tel" placeholder="010-1234-5678" value={phone} onChange={(e) => setPhone(e.target.value)} error={!!errors.phone} dataComponent="contact-form-field-input" aria-required="true" />
                  </FormField>
                </div>

                <FormField label="이메일" required error={errors.email} htmlFor="contact-email" dataComponent="contact-form-field">
                  <Input id="contact-email" type="email" placeholder="example@email.com" value={email} onChange={(e) => setEmail(e.target.value)} error={!!errors.email} dataComponent="contact-form-field-input" required aria-required="true" />
                </FormField>

                <FormField label="문의 유형" required error={errors.subject} htmlFor="contact-subject" dataComponent="contact-form-field">
                  <select
                    id="contact-subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    data-component="contact-form-field-input"
                    aria-required="true"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      fontSize: "var(--text-sm)",
                      border: `1px solid ${errors.subject ? "var(--color-error)" : "var(--color-neutral-300)"}`,
                      borderRadius: "var(--radius-md)",
                      background: "var(--color-neutral-0)",
                      color: subject ? "var(--color-neutral-800)" : "var(--color-neutral-400)",
                    }}
                  >
                    <option value="" disabled>문의 유형을 선택해 주세요</option>
                    <option value="service">서비스 관련 문의</option>
                    <option value="pricing">비용 관련 문의</option>
                    <option value="voucher">정부지원 바우처 문의</option>
                    <option value="other">기타 문의</option>
                  </select>
                </FormField>

                <FormField label="문의 내용" required error={errors.message} htmlFor="contact-message" dataComponent="contact-form-field">
                  <Textarea id="contact-message" placeholder="문의하실 내용을 자유롭게 작성해 주세요." rows={5} value={message} onChange={(e) => setMessage(e.target.value)} dataComponent="contact-form-field-input" aria-required="true" />
                </FormField>

                <div data-component="contact-form-consent" style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
                  <input type="checkbox" id="contact-consent" checked={privacyAgreed} onChange={(e) => setPrivacyAgreed(e.target.checked)} style={{ width: "18px", height: "18px", marginTop: "2px", accentColor: "var(--color-primary-500)", flexShrink: 0 }} aria-required="true" />
                  <label htmlFor="contact-consent" style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-600)", lineHeight: "var(--leading-relaxed)" }}>
                    <a href="/disclaimer" target="_blank" style={{ color: "var(--color-primary-500)", textDecoration: "underline" }}>개인정보처리방침</a>에 동의합니다. (필수)
                  </label>
                </div>
                {errors.privacy && <p role="alert" style={{ fontSize: "var(--text-xs)", color: "var(--color-error)", marginBottom: "var(--space-4)", marginTop: "calc(-1 * var(--space-2))" }}>{errors.privacy}</p>}

                <Button variant="primary" size="lg" fullWidth loading={formState === "submitting"} dataComponent="contact-form-submit" style={{ marginTop: "var(--space-2)" }}>
                  문의 보내기
                </Button>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* Map Section */}
      <section data-component="map" aria-label="오시는 길" style={{ padding: "0 0 var(--space-20)", background: "var(--color-neutral-0)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div data-component="map-placeholder" style={{ width: "100%", height: "350px", borderRadius: "var(--radius-md)", background: "var(--color-neutral-100)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--space-3)" }}>
            <div aria-hidden="true" style={{ fontSize: "48px" }}>{"\u{1F5FA}"}</div>
            <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-500)" }}>오시는 길</p>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-400)" }}>네이버 지도 또는 카카오맵이 삽입될 영역입니다</p>
          </div>
          <p style={{ marginTop: "var(--space-4)", fontSize: "var(--text-sm)", color: "var(--color-neutral-600)", textAlign: "center" }}>
            <strong>인천 아이미래로</strong> &mdash; {COMPANY_INFO.address}
          </p>
        </div>
      </section>

      <style>{`
        @media (max-width: 1023px) {
          .contact-layout { grid-template-columns: 1fr !important; }
          .form-row { grid-template-columns: 1fr !important; }
          .page-header-title { font-size: var(--text-4xl) !important; }
        }
        @media (max-width: 767px) {
          .page-header-title { font-size: var(--text-3xl) !important; }
        }
      `}</style>
    </>
  );
}
