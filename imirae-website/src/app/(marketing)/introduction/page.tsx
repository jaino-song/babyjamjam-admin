import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui";
import { StatDisplay } from "@/components/ui/stat-display";
import { ConsultationCtaButton } from "@/components/ui/consultation-cta-button";

export const metadata: Metadata = {
  title: "소개 | 인천 아이미래로",
  description: "인천 아이미래로의 경영 철학과 핵심 가치를 소개합니다. 15년 이상의 산후관리 경험, 국가자격증 보유 전문 관리사, 고객 만족도 98%.",
};

export default function IntroductionPage() {

  return (
    <>
      {/* Page Header */}
      <section
        data-component="about-header"
        aria-label="소개 페이지 헤더"
        style={{
          paddingTop: "calc(var(--nav-height) + var(--space-16))",
          paddingBottom: "var(--space-16)",
          background: "linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-bg-cream) 100%)",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <span data-component="about-header-badge" style={{ display: "inline-flex", padding: "4px 12px", borderRadius: "var(--radius-full)", fontSize: "var(--text-xs)", fontWeight: "var(--font-medium)" as string, marginBottom: "var(--space-4)", background: "var(--color-primary-100)", color: "var(--color-primary-700)" }}>About Us</span>
          <h1 data-component="about-header-title" className="page-header-title" style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-5xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", lineHeight: "var(--leading-tight)", marginBottom: "var(--space-4)" }}>인천 아이미래로를<br />소개합니다</h1>
          <p data-component="about-header-desc" style={{ fontSize: "var(--text-lg)", color: "var(--color-neutral-500)", maxWidth: "600px", margin: "0 auto", lineHeight: "var(--leading-relaxed)" }}>엄마와 아기의 건강한 시작을 함께하는 인천 남동구 산후관리 전문 기관</p>
        </div>
      </section>

      {/* Philosophy */}
      <section data-component="philosophy" aria-label="경영 철학" style={{ padding: "var(--space-20) 0", background: "var(--color-neutral-0)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div data-component="philosophy-content" className="philosophy-content" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-12)", alignItems: "center" }}>
            <div aria-hidden="true" style={{ display: "flex", justifyContent: "center", animation: "fadeIn var(--duration-slow) var(--ease-out)" }}>
              <div style={{ width: "100%", maxWidth: "400px", aspectRatio: "1", borderRadius: "var(--radius-xl)", background: "linear-gradient(135deg, var(--color-primary-100), var(--color-secondary-100))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "120px" }}>{"\u{1F468}\u200D\u{1F469}\u200D\u{1F467}"}</div>
            </div>
            <div style={{ animation: "fadeInUp var(--duration-normal) var(--ease-out)" }}>
              <span data-component="philosophy-badge" style={{ display: "inline-flex", padding: "4px 12px", borderRadius: "var(--radius-full)", fontSize: "var(--text-xs)", fontWeight: "var(--font-medium)" as string, marginBottom: "var(--space-4)", background: "var(--color-primary-100)", color: "var(--color-primary-700)" }}>우리의 철학</span>
              <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-3xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", marginBottom: "var(--space-4)", lineHeight: "var(--leading-tight)" }}>아이의 미래를 위한<br />따뜻한 첫 걸음</h2>
              <p style={{ fontSize: "var(--text-base)", color: "var(--color-neutral-600)", lineHeight: "var(--leading-relaxed)", marginBottom: "var(--space-4)" }}>인천 아이미래로는 &quot;아이의 미래가 밝은 세상&quot;이라는 비전 아래 설립되었습니다. 산모와 신생아 모두에게 가장 안전하고 따뜻한 환경을 제공하는 것이 저희의 사명입니다.</p>
              <p style={{ fontSize: "var(--text-base)", color: "var(--color-neutral-600)", lineHeight: "var(--leading-relaxed)", marginBottom: "var(--space-4)" }}>15년 이상의 산후관리 경험과 체계적인 교육 시스템을 바탕으로, 매 가정에 맞춤형 케어를 제공합니다. 단순한 서비스 제공을 넘어 산모의 정서적 안정까지 돌보는 것이 저희 아이미래로의 차별점입니다.</p>
              <p style={{ fontSize: "var(--text-base)", color: "var(--color-neutral-600)", lineHeight: "var(--leading-relaxed)" }}>모든 관리사는 국가자격증을 보유하고 정기 보수교육을 이수하여, 항상 최신의 전문 케어를 제공할 수 있도록 하고 있습니다.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CEO Quote */}
      <section data-component="ceo-quote" aria-label="대표 인사말" style={{ padding: "var(--space-20) 0", background: "var(--color-bg-cream)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div style={{ maxWidth: "800px", margin: "0 auto", textAlign: "center", animation: "fadeInUp var(--duration-normal) var(--ease-out)" }}>
            <div aria-hidden="true" style={{ fontSize: "72px", color: "var(--color-primary-200)", lineHeight: 1, marginBottom: "var(--space-4)" }}>&ldquo;</div>
            <blockquote data-component="ceo-quote-text" style={{ fontSize: "var(--text-xl)", color: "var(--color-neutral-700)", lineHeight: "var(--leading-relaxed)", marginBottom: "var(--space-8)", fontStyle: "italic" }}>
              &ldquo;모든 아이의 시작이 따뜻하고 건강하길 바라는 마음으로, 한 가정 한 가정에 정성을 다하겠습니다. 엄마와 아기의 미래를 함께 만들어 나가는 것이 저희의 약속입니다.&rdquo;
            </blockquote>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--space-3)" }}>
              <div data-component="ceo-quote-avatar" aria-hidden="true" style={{ width: "56px", height: "56px", borderRadius: "var(--radius-full)", background: "var(--color-primary-100)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "28px" }}>{"\u{1F469}\u200D\u{1F4BC}"}</div>
              <div style={{ textAlign: "left" }}>
                <div data-component="ceo-quote-name" style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-800)" }}>송영란 대표</div>
                <div data-component="ceo-quote-role" style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)" }}>인천 아이미래로 대표이사</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section data-component="stats" aria-label="실적 통계" style={{ padding: "var(--space-16) 0", background: "var(--color-primary-500)", color: "white" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div data-component="stats-grid" className="stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-8)", textAlign: "center" }}>
            {[
              { value: "2,500+", label: "누적 서비스 건수" },
              { value: "15년+", label: "산후관리 경력" },
              { value: "98%", label: "고객 만족도" },
              { value: "50+", label: "전문 관리사" },
            ].map((stat, i) => (
              <StatDisplay key={stat.label} value={stat.value} label={stat.label} light dataComponent="stats-grid-stat" staggerIndex={i} />
            ))}
          </div>
        </div>
      </section>

      {/* Core Values */}
      <section data-component="values" aria-label="핵심 가치" style={{ padding: "var(--space-20) 0", background: "var(--color-neutral-0)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div style={{ textAlign: "center", marginBottom: "var(--space-12)" }}>
            <span data-component="values-badge" style={{ display: "inline-flex", padding: "4px 12px", borderRadius: "var(--radius-full)", fontSize: "var(--text-xs)", fontWeight: "var(--font-medium)" as string, marginBottom: "var(--space-4)", background: "var(--color-secondary-100)", color: "var(--color-secondary-700)" }}>핵심 가치</span>
            <h2 data-component="values-title" style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-4xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", marginBottom: "var(--space-4)", lineHeight: "var(--leading-tight)" }}>아이미래로가 지키는 약속</h2>
            <p data-component="values-subtitle" style={{ fontSize: "var(--text-lg)", color: "var(--color-neutral-500)", maxWidth: "600px", margin: "0 auto", lineHeight: "var(--leading-relaxed)" }}>세 가지 핵심 가치를 바탕으로 최고의 서비스를 제공합니다</p>
          </div>
          <div className="values-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-6)" }}>
            {[
              { icon: "\u{1F496}", bg: "var(--color-primary-100)", title: "따뜻한 돌봄", desc: "산모와 신생아에게 가족과 같은 따뜻함으로 다가갑니다. 정서적 안정과 신체 회복을 동시에 돌봅니다." },
              { icon: "\u{1F393}", bg: "var(--color-secondary-100)", title: "전문적인 케어", desc: "국가자격증을 보유한 전문 관리사가 체계적인 교육과 최신 기법으로 최고 수준의 서비스를 제공합니다." },
              { icon: "\u{1F91D}", bg: "var(--color-accent-100)", title: "신뢰와 소통", desc: "투명한 운영과 열린 소통으로 고객과의 신뢰 관계를 쌓아갑니다. 매일 서비스 보고서를 제공합니다." },
            ].map((value, i) => (
              <div key={value.title} data-component="values-grid-card" style={{ background: "var(--color-bg-card)", borderRadius: "var(--radius-md)", padding: "var(--space-8)", textAlign: "center", boxShadow: "var(--shadow-sm)", animation: "fadeInUp var(--duration-normal) var(--ease-out)", animationFillMode: "both", animationDelay: `${i * 100}ms` }}>
                <div aria-hidden="true" style={{ width: "64px", height: "64px", margin: "0 auto var(--space-4)", borderRadius: "var(--radius-lg)", background: value.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "28px" }}>{value.icon}</div>
                <h3 style={{ fontSize: "var(--text-xl)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-800)", marginBottom: "var(--space-3)" }}>{value.title}</h3>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", lineHeight: "var(--leading-relaxed)" }}>{value.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Certifications */}
      <section data-component="certifications" aria-label="인증 및 수상" style={{ padding: "var(--space-20) 0", background: "var(--color-bg-cream)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div style={{ textAlign: "center", marginBottom: "var(--space-12)" }}>
            <span data-component="certifications-badge" style={{ display: "inline-flex", padding: "4px 12px", borderRadius: "var(--radius-full)", fontSize: "var(--text-xs)", fontWeight: "var(--font-medium)" as string, marginBottom: "var(--space-4)", background: "var(--color-primary-100)", color: "var(--color-primary-700)" }}>인증 및 수상</span>
            <h2 data-component="certifications-title" style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-4xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", marginBottom: "var(--space-4)", lineHeight: "var(--leading-tight)" }}>검증된 전문성</h2>
            <p data-component="certifications-subtitle" style={{ fontSize: "var(--text-lg)", color: "var(--color-neutral-500)", maxWidth: "600px", margin: "0 auto", lineHeight: "var(--leading-relaxed)" }}>다양한 인증과 수상 이력으로 전문성을 증명합니다</p>
          </div>
          <div className="cert-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-6)" }}>
            {[
              { icon: "\u{1F3C6}", name: "산모\xB7신생아 건강관리\n우수 제공기관", desc: "보건복지부 인증" },
              { icon: "\u{1F4C8}", name: "서비스 품질 인증", desc: "인천광역시 남동구" },
              { icon: "\u{1F64B}\u200D\u2640\uFE0F", name: "산후관리사\n국가자격 보유", desc: "전체 관리사 100%" },
              { icon: "\u{1F499}", name: "고객 만족 우수상", desc: "3년 연속 수상" },
            ].map((cert) => (
              <div key={cert.name} data-component="certifications-grid-card" style={{ background: "var(--color-bg-card)", borderRadius: "var(--radius-md)", padding: "var(--space-6)", textAlign: "center", boxShadow: "var(--shadow-sm)" }}>
                <div aria-hidden="true" style={{ fontSize: "36px", marginBottom: "var(--space-3)" }}>{cert.icon}</div>
                <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-700)", marginBottom: "var(--space-2)", whiteSpace: "pre-line" }}>{cert.name}</div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-400)" }}>{cert.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section data-component="timeline" aria-label="연혁" style={{ padding: "var(--space-20) 0", background: "var(--color-neutral-0)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div style={{ textAlign: "center", marginBottom: "var(--space-12)" }}>
            <span data-component="timeline-badge" style={{ display: "inline-flex", padding: "4px 12px", borderRadius: "var(--radius-full)", fontSize: "var(--text-xs)", fontWeight: "var(--font-medium)" as string, marginBottom: "var(--space-4)", background: "var(--color-primary-100)", color: "var(--color-primary-700)" }}>연혁</span>
            <h2 data-component="timeline-title" style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-4xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", lineHeight: "var(--leading-tight)" }}>아이미래로의 발자취</h2>
          </div>
          <div style={{ maxWidth: "600px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            {[
              { year: "2010", title: "인천 아이미래로 설립", desc: "인천 남동구에서 산후관리 전문 기관으로 첫 발을 내딛다", num: "1" },
              { year: "2014", title: "정부지원 바우처 사업자 선정", desc: "산모\xB7신생아 건강관리 정부지원 바우처 제공기관으로 선정", num: "2" },
              { year: "2018", title: "누적 서비스 1,000건 달성", desc: "인천 지역 산후관리 서비스 1,000건 돌파", num: "3" },
              { year: "2022", title: "서비스 품질 인증 획득", desc: "우수 제공기관 인증 및 고객 만족 우수상 수상", num: "4" },
              { year: "2025", title: "누적 서비스 2,500건 돌파", desc: "전문 관리사 50명 이상, 고객 만족도 98% 유지", num: "5" },
            ].map((item, i) => (
              <div key={item.year} data-component="timeline-item" style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-start", animation: "fadeInUp var(--duration-normal) var(--ease-out)", animationFillMode: "both", animationDelay: `${i * 100}ms` }}>
                <div style={{ width: "40px", height: "40px", borderRadius: "var(--radius-full)", background: "var(--color-primary-500)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "var(--font-bold)" as string, fontSize: "var(--text-sm)", flexShrink: 0 }}>{item.num}</div>
                <div style={{ paddingTop: "var(--space-2)" }}>
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-primary-500)", marginBottom: "var(--space-1)" }}>{item.year}</div>
                  <div style={{ fontSize: "var(--text-lg)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-800)", marginBottom: "var(--space-1)" }}>{item.title}</div>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", lineHeight: "var(--leading-relaxed)" }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section data-component="cta" aria-label="상담 신청" style={{ padding: "var(--space-20) 0", background: "linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-bg-cream) 100%)", textAlign: "center" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div style={{ maxWidth: "640px", margin: "0 auto", animation: "fadeInUp var(--duration-normal) var(--ease-out)" }}>
            <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-4xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", marginBottom: "var(--space-4)", lineHeight: "var(--leading-tight)" }}>아이미래로와 함께<br />건강한 시작을 준비하세요</h2>
            <p style={{ fontSize: "var(--text-lg)", color: "var(--color-neutral-600)", marginBottom: "var(--space-8)", lineHeight: "var(--leading-relaxed)" }}>무료 상담을 통해 맞춤 서비스를 안내받으실 수 있습니다.</p>
            <div style={{ display: "flex", gap: "var(--space-4)", justifyContent: "center", flexWrap: "wrap" as const }}>
              <ConsultationCtaButton dataComponent="cta-actions-primary">무료 상담 신청</ConsultationCtaButton>
              <Link href="/contact"><Button variant="outline" size="lg" dataComponent="cta-actions-secondary">문의하기</Button></Link>
            </div>
          </div>
        </div>
      </section>

      <style>{`
        @media (max-width: 1023px) {
          .philosophy-content { grid-template-columns: 1fr !important; }
          .values-grid { grid-template-columns: 1fr !important; max-width: 400px !important; margin: 0 auto !important; }
          .cert-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .page-header-title { font-size: var(--text-4xl) !important; }
        }
        @media (max-width: 767px) {
          .page-header-title { font-size: var(--text-3xl) !important; }
          .cert-grid { grid-template-columns: 1fr !important; }
          .stats-grid { grid-template-columns: repeat(2, 1fr) !important; gap: var(--space-4) !important; }
        }
      `}</style>
    </>
  );
}
