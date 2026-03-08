"use client";

import { useState } from "react";
import { Button, Badge } from "@/components/ui";
import { ConsultationCtaButton } from "@/components/ui/consultation-cta-button";
import { COMPANY_INFO, EXTERNAL_LINKS } from "@/types/models";

export default function PlanPage() {

  const plans = [
    {
      name: "스탠다드",
      duration: "10일 (주 5일)",
      price: "1,200,000",
      featured: false,
      features: [
        { text: "산모 건강관리 (기본)", included: true },
        { text: "신생아 돌봄 (목욕, 수유지원)", included: true },
        { text: "기본 가사 지원", included: true },
        { text: "산모 영양식 1식 준비", included: true },
        { text: "산후 체조 프로그램", included: false },
        { text: "일일 보고서", included: false },
      ],
    },
    {
      name: "프리미엄",
      duration: "15일 (주 5일)",
      price: "1,800,000",
      featured: true,
      features: [
        { text: "산모 건강관리 (전문)", included: true },
        { text: "신생아 돌봄 (목욕, 수유, 건강체크)", included: true },
        { text: "전체 가사 지원", included: true },
        { text: "산모 영양식 2식 준비", included: true },
        { text: "산후 체조 프로그램", included: true },
        { text: "일일 보고서", included: true },
      ],
    },
    {
      name: "VIP",
      duration: "20일 (주 5일)",
      price: "2,400,000",
      featured: false,
      features: [
        { text: "산모 건강관리 (프리미엄)", included: true },
        { text: "신생아 전담 돌봄", included: true },
        { text: "전체 가사 지원 + 큰 아이 돌봄", included: true },
        { text: "산모 영양식 3식 준비", included: true },
        { text: "산후 체조 + 마사지", included: true },
        { text: "일일 보고서 + 주간 상담", included: true },
      ],
    },
  ];

  const faqs = [
    { q: "정부지원 바우처로 비용을 얼마나 줄일 수 있나요?", a: "소득 기준에 따라 지원 금액이 달라지며, 일반형 기준 최대 월 840,000원까지 지원됩니다. 본인부담금은 소득 구간에 따라 차등 적용되며, 상담 시 정확한 금액을 안내해 드립니다." },
    { q: "서비스 기간을 연장하거나 변경할 수 있나요?", a: "네, 서비스 이용 중 기간 연장이나 변경이 가능합니다. 다만, 관리사 스케줄 조정이 필요하므로 가능한 빨리 문의해 주시면 최대한 맞춰드립니다." },
    { q: "쌍둥이인 경우 추가 비용이 있나요?", a: "다태아의 경우 추가 비용이 발생할 수 있으며, 정부지원 바우처도 추가 지원이 가능합니다. 정확한 비용은 상담을 통해 안내해 드립니다." },
    { q: "결제 방법은 어떻게 되나요?", a: "계좌이체 또는 카드결제가 가능하며, 정부지원 바우처를 함께 사용하실 경우 국민행복카드로 결제하시면 됩니다." },
    { q: "서비스 중도 취소 시 환불이 되나요?", a: "서비스 시작 전 전액 환불이 가능하며, 서비스 이용 중에는 남은 일수에 대해 일할 환불이 가능합니다. 자세한 환불 정책은 이용약관을 참고해 주세요." },
  ];

  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <>
      {/* Page Header */}
      <section data-component="pricing-header" style={{ paddingTop: "calc(var(--nav-height) + var(--space-16))", paddingBottom: "var(--space-16)", background: "linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-bg-cream) 100%)", textAlign: "center" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <span data-component="pricing-header-badge" style={{ display: "inline-flex", padding: "4px 12px", borderRadius: "var(--radius-full)", fontSize: "var(--text-xs)", fontWeight: "var(--font-medium)" as string, marginBottom: "var(--space-4)", background: "var(--color-primary-100)", color: "var(--color-primary-700)" }}>Pricing</span>
          <h1 data-component="pricing-header-title" className="page-header-title" style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-5xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", lineHeight: "var(--leading-tight)", marginBottom: "var(--space-4)" }}>서비스 비용 안내</h1>
          <p data-component="pricing-header-desc" style={{ fontSize: "var(--text-lg)", color: "var(--color-neutral-500)", maxWidth: "640px", margin: "0 auto", lineHeight: "var(--leading-relaxed)" }}>합리적인 비용으로 최고의 산후관리 서비스를 제공합니다. 정부지원 바우처 사용이 가능합니다.</p>
        </div>
      </section>

      {/* Pricing Grid */}
      <section data-component="pricing" aria-label="서비스 비용" style={{ padding: "var(--space-20) 0", background: "var(--color-neutral-0)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div data-component="pricing-grid" className="pricing-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-6)", alignItems: "stretch" }}>
            {plans.map((plan, i) => (
              <div key={plan.name} data-component="pricing-grid-card" style={{ background: "var(--color-bg-card)", borderRadius: "var(--radius-md)", overflow: "hidden", boxShadow: plan.featured ? "var(--shadow-xl)" : "var(--shadow-sm)", border: plan.featured ? "2px solid var(--color-primary-500)" : "1px solid var(--color-neutral-200)", position: "relative", display: "flex", flexDirection: "column", animation: "fadeInUp var(--duration-normal) var(--ease-out)", animationFillMode: "both", animationDelay: `${i * 100}ms`, transform: plan.featured ? "scale(1.05)" : "none" }}>
                {plan.featured && (
                  <div data-component="pricing-grid-card-popular" style={{ background: "var(--color-primary-500)", color: "white", textAlign: "center", padding: "var(--space-2)", fontSize: "var(--text-xs)", fontWeight: "var(--font-semibold)" as string }}>가장 인기</div>
                )}
                <div style={{ padding: "var(--space-8)", textAlign: "center", borderBottom: "1px solid var(--color-neutral-100)" }}>
                  <div style={{ fontSize: "var(--text-xl)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-800)", marginBottom: "var(--space-1)" }}>{plan.name}</div>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-400)", marginBottom: "var(--space-4)" }}>{plan.duration}</div>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: "var(--space-1)" }}>
                    <span style={{ fontSize: "var(--text-4xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)" }}>{plan.price}</span>
                    <span style={{ fontSize: "var(--text-base)", color: "var(--color-neutral-500)" }}>원</span>
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)", marginTop: "var(--space-2)" }}>정부지원 시 본인부담금 별도 안내</div>
                </div>
                <div style={{ padding: "var(--space-6)", flex: 1 }}>
                  {plan.features.map((f) => (
                    <div key={f.text} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)", color: f.included ? "var(--color-neutral-600)" : "var(--color-neutral-400)", marginBottom: "var(--space-3)" }}>
                      <span aria-hidden="true" style={{ color: f.included ? "var(--color-secondary-500)" : "var(--color-neutral-300)", fontWeight: "var(--font-bold)" as string }}>{f.included ? "\u2713" : "\u2014"}</span>
                      <span>{f.text}</span>
                    </div>
                  ))}
                </div>
                <div style={{ padding: "0 var(--space-6) var(--space-6)" }}>
                  <ConsultationCtaButton variant={plan.featured ? "primary" : "secondary"} size="md" dataComponent="pricing-grid-card-cta">상담 신청</ConsultationCtaButton>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Government Support */}
      <section data-component="gov-support" aria-label="정부지원 안내" style={{ padding: "var(--space-20) 0", background: "var(--color-bg-cream)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div data-component="gov-support-card" className="gov-support-layout" style={{ background: "var(--color-bg-card)", borderRadius: "var(--radius-lg)", padding: "var(--space-10)", boxShadow: "var(--shadow-md)", display: "grid", gridTemplateColumns: "1fr auto", gap: "var(--space-10)", alignItems: "center" }}>
            <div>
              <Badge variant="accent" size="md" dataComponent="gov-support-badge">정부지원</Badge>
              <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-3xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", margin: "var(--space-4) 0", lineHeight: "var(--leading-tight)" }}>산모 \xB7 신생아 건강관리<br />정부지원 바우처</h2>
              <p style={{ fontSize: "var(--text-base)", color: "var(--color-neutral-600)", lineHeight: "var(--leading-relaxed)", marginBottom: "var(--space-6)" }}>정부에서 지원하는 산모\xB7신생아 건강관리 바우처를 사용하시면 합리적인 비용으로 전문 산후관리 서비스를 이용하실 수 있습니다.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                {[
                  { icon: "\u{1F464}", label: "지원 대상", desc: "산모\xB7신생아 건강관리 지원사업 대상자 (소득 기준에 따라 차등 지원)" },
                  { icon: "\u{1F4B0}", label: "지원 금액", desc: "서비스 유형에 따라 최대 월 840,000원까지 지원 (본인부담금 별도)" },
                  { icon: "\u{1F4CB}", label: "신청 방법", desc: "복지로 홈페이지 또는 주민센터에서 신청 가능" },
                ].map((item) => (
                  <div key={item.label} style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
                    <div aria-hidden="true" style={{ fontSize: "20px", flexShrink: 0 }}>{item.icon}</div>
                    <div>
                      <strong style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-800)" }}>{item.label}</strong>
                      <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", marginTop: "var(--space-1)" }}>{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", alignItems: "center" }}>
              <div aria-hidden="true" style={{ width: "200px", height: "200px", borderRadius: "var(--radius-xl)", background: "linear-gradient(135deg, var(--color-secondary-100), var(--color-accent-100))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "72px" }}>{"\u{1F3ED}"}</div>
              <a href={EXTERNAL_LINKS.govSupportCheck} target="_blank" rel="noopener noreferrer"><Button variant="primary" dataComponent="gov-support-check">자격 조회하기</Button></a>
              <a href={EXTERNAL_LINKS.govSupportApply} target="_blank" rel="noopener noreferrer"><Button variant="outline" dataComponent="gov-support-apply">바우처 신청하기</Button></a>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section data-component="faq" aria-label="자주 묻는 질문" style={{ padding: "var(--space-20) 0", background: "var(--color-neutral-0)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div style={{ textAlign: "center", marginBottom: "var(--space-12)" }}>
            <span data-component="faq-badge" style={{ display: "inline-flex", padding: "4px 12px", borderRadius: "var(--radius-full)", fontSize: "var(--text-xs)", fontWeight: "var(--font-medium)" as string, marginBottom: "var(--space-4)", background: "var(--color-primary-100)", color: "var(--color-primary-700)" }}>FAQ</span>
            <h2 data-component="faq-title" style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-4xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", marginBottom: "var(--space-4)", lineHeight: "var(--leading-tight)" }}>자주 묻는 질문</h2>
            <p data-component="faq-subtitle" style={{ fontSize: "var(--text-lg)", color: "var(--color-neutral-500)" }}>비용 관련 궁금한 점을 확인해 보세요</p>
          </div>
          <div data-component="faq-list" style={{ maxWidth: "800px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {faqs.map((faq, i) => (
              <div key={i} data-component="faq-list-item" style={{ border: "1px solid var(--color-neutral-200)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-4) var(--space-5)", fontSize: "var(--text-base)", fontWeight: "var(--font-medium)" as string, color: "var(--color-neutral-700)", background: openFaq === i ? "var(--color-neutral-50)" : "var(--color-bg-card)", textAlign: "left", cursor: "pointer" }}
                >
                  <span>{faq.q}</span>
                  <span aria-hidden="true" style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-400)", transform: openFaq === i ? "rotate(180deg)" : "none", transition: "transform var(--duration-fast)" }}>{"\u25BC"}</span>
                </button>
                {openFaq === i && (
                  <div style={{ padding: "0 var(--space-5) var(--space-4)", fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", lineHeight: "var(--leading-relaxed)", background: "var(--color-neutral-50)" }}>{faq.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section data-component="cta" aria-label="상담 신청" style={{ padding: "var(--space-20) 0", background: "linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-bg-cream) 100%)", textAlign: "center" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div style={{ maxWidth: "640px", margin: "0 auto", animation: "fadeInUp var(--duration-normal) var(--ease-out)" }}>
            <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-4xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", marginBottom: "var(--space-4)", lineHeight: "var(--leading-tight)" }}>맞춤 비용 상담을<br />받아보세요</h2>
            <p style={{ fontSize: "var(--text-lg)", color: "var(--color-neutral-600)", marginBottom: "var(--space-8)", lineHeight: "var(--leading-relaxed)" }}>정부지원 바우처 자격 확인부터 맞춤 서비스 비용까지<br />친절하게 안내해 드립니다.</p>
            <div style={{ display: "flex", gap: "var(--space-4)", justifyContent: "center" }}>
              <ConsultationCtaButton dataComponent="cta-actions-primary">무료 상담 신청</ConsultationCtaButton>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-lg)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-700)", marginTop: "var(--space-6)", justifyContent: "center" }}>
              <span aria-hidden="true">&#128222;</span>
              <a href="tel:032-442-5992">{COMPANY_INFO.phone}</a>
            </div>
          </div>
        </div>
      </section>

      <style>{`
        @media (max-width: 1023px) {
          .pricing-grid { grid-template-columns: 1fr !important; max-width: 480px !important; margin: 0 auto !important; }
          .pricing-grid > div { transform: none !important; }
          .gov-support-layout { grid-template-columns: 1fr !important; }
          .page-header-title { font-size: var(--text-4xl) !important; }
        }
        @media (max-width: 767px) {
          .page-header-title { font-size: var(--text-3xl) !important; }
        }
      `}</style>
    </>
  );
}
