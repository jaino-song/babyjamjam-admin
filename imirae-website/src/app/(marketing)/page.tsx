import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui";
import { TestimonialCard } from "@/components/ui/testimonial-card";
import { StatDisplay } from "@/components/ui/stat-display";
import { ConsultationCtaButton } from "@/components/ui/consultation-cta-button";
import { COMPANY_INFO, EXTERNAL_LINKS } from "@/types/models";

export const metadata: Metadata = {
  title: "인천 아이미래로 | 산후관리 전문",
  description: "인천 남동구 산후관리 전문. 2,500건 이상의 경험으로 산모와 신생아에게 따뜻하고 전문적인 케어를 제공합니다. 정부지원 바우처 이용 가능.",
};

export default function HomePage() {

  return (
    <>
      {/* Hero Section */}
      <section
        data-component="hero"
        aria-label="메인 배너"
        style={{
          minHeight: "100dvh",
          paddingTop: "var(--nav-height)",
          background:
            "linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-bg-cream) 50%, var(--color-secondary-50) 100%)",
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          data-component="hero-container"
          className="hero-container"
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "var(--space-16) var(--space-6)",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "var(--space-12)",
            alignItems: "center",
          }}
        >
          <div
            data-component="hero-content"
            style={{ animation: "fadeInUp var(--duration-normal) var(--ease-out)" }}
          >
            <span
              data-component="hero-content-badge"
              style={{
                display: "inline-flex",
                padding: "6px 16px",
                borderRadius: "var(--radius-full)",
                background: "var(--color-primary-100)",
                color: "var(--color-primary-700)",
                fontSize: "var(--text-sm)",
                fontWeight: "var(--font-medium)" as string,
                marginBottom: "var(--space-6)",
              }}
            >
              &#128150; 인천 남동구 산후관리 전문
            </span>
            <h1
              data-component="hero-content-title"
              className="hero-title"
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: "var(--text-5xl)",
                fontWeight: "var(--font-bold)" as string,
                color: "var(--color-neutral-900)",
                lineHeight: "var(--leading-tight)",
                marginBottom: "var(--space-6)",
              }}
            >
              엄마와 아기의
              <br />
              <em style={{ color: "var(--color-primary-500)", fontStyle: "normal" }}>건강한 시작</em>을
              <br />
              함께합니다
            </h1>
            <p
              data-component="hero-content-description"
              style={{
                fontSize: "var(--text-lg)",
                color: "var(--color-neutral-600)",
                lineHeight: "var(--leading-relaxed)",
                marginBottom: "var(--space-8)",
                maxWidth: "480px",
              }}
            >
              인천 아이미래로는 2,500건 이상의 산후관리 경험을 바탕으로 산모와
              신생아에게 따뜻하고 전문적인 케어를 제공합니다.
            </p>
            <div
              data-component="hero-content-actions"
              style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" as const }}
            >
              <ConsultationCtaButton dataComponent="hero-content-actions-primary">무료 상담 신청</ConsultationCtaButton>
              <Link href="/program">
                <Button variant="outline" size="lg" dataComponent="hero-content-actions-secondary">
                  서비스 알아보기
                </Button>
              </Link>
            </div>
          </div>
          <div
            data-component="hero-visual"
            className="hero-visual"
            aria-hidden="true"
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              animation: "fadeIn var(--duration-slow) var(--ease-out)",
              animationDelay: "200ms",
              animationFillMode: "both",
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: "480px",
                aspectRatio: "1",
                background: "linear-gradient(135deg, var(--color-primary-100), var(--color-secondary-100))",
                borderRadius: "40% 60% 60% 40% / 60% 30% 70% 40%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                animation: "float 6s ease-in-out infinite",
              }}
            >
              <span style={{ fontSize: "120px", opacity: 0.8 }}>&#128118;</span>
              <div style={{ position: "absolute", top: "20%", right: "-10%", background: "white", borderRadius: "var(--radius-md)", padding: "var(--space-3) var(--space-4)", boxShadow: "var(--shadow-lg)", fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)" as string, display: "flex", alignItems: "center", gap: "var(--space-2)", color: "var(--color-secondary-700)" }}>
                &#9989; 정부지원 가능
              </div>
              <div style={{ position: "absolute", bottom: "15%", left: "-8%", background: "white", borderRadius: "var(--radius-md)", padding: "var(--space-3) var(--space-4)", boxShadow: "var(--shadow-lg)", fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)" as string, display: "flex", alignItems: "center", gap: "var(--space-2)", color: "var(--color-primary-700)" }}>
                &#128150; 2,500+ 서비스
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Action Cards */}
      <section data-component="quick-actions" aria-label="빠른 메뉴" style={{ padding: "var(--space-16) 0", background: "var(--color-neutral-0)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div data-component="quick-actions-grid" className="quick-actions-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-6)" }}>
            {[
              { href: EXTERNAL_LINKS.govSupportCheck, icon: "\u{1F4CB}", color: "var(--color-primary-100)", title: "정부지원 자격 조회", desc: "산모 및 신생아 건강관리 정부지원 자격을 확인해 보세요.", external: true },
              { href: EXTERNAL_LINKS.govSupportApply, icon: "\u{1F4DD}", color: "var(--color-secondary-100)", title: "정부지원 신청하기", desc: "복지로에서 바로 정부지원 바우처를 신청하실 수 있습니다.", external: true },
              { href: "/plan", icon: "\u{1F4B0}", color: "var(--color-accent-100)", title: "서비스 비용 안내", desc: "합리적인 비용으로 최고의 산후관리 서비스를 받아보세요.", external: false },
            ].map((card, i) => {
              const inner = (
                <>
                  <div aria-hidden="true" style={{ width: "64px", height: "64px", margin: "0 auto var(--space-4)", borderRadius: "var(--radius-lg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "28px", background: card.color }}>{card.icon}</div>
                  <h3 style={{ fontSize: "var(--text-xl)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-800)", marginBottom: "var(--space-2)" }}>{card.title}</h3>
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", lineHeight: "var(--leading-relaxed)" }}>{card.desc}</p>
                </>
              );
              const style: React.CSSProperties = {
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-neutral-200)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-8)",
                textAlign: "center",
                transition: "all var(--duration-normal) var(--ease-default)",
                animation: "fadeInUp var(--duration-normal) var(--ease-out)",
                animationFillMode: "both",
                animationDelay: `${i * 100}ms`,
                cursor: "pointer",
                textDecoration: "none",
                display: "block",
              };
              return card.external ? (
                <a key={card.title} href={card.href} target="_blank" rel="noopener noreferrer" data-component="quick-actions-grid-card" style={style}>{inner}</a>
              ) : (
                <Link key={card.title} href={card.href} data-component="quick-actions-grid-card" style={style}>{inner}</Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* Services Overview */}
      <section data-component="services" aria-label="서비스 소개" style={{ padding: "var(--space-20) 0", background: "var(--color-bg-cream)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div style={{ textAlign: "center", marginBottom: "var(--space-12)", animation: "fadeInUp var(--duration-normal) var(--ease-out)" }}>
            <span style={{ display: "inline-flex", padding: "4px 12px", borderRadius: "var(--radius-full)", fontSize: "var(--text-xs)", fontWeight: "var(--font-medium)" as string, marginBottom: "var(--space-4)", background: "var(--color-secondary-100)", color: "var(--color-secondary-700)" }} data-component="services-badge">서비스 안내</span>
            <h2 data-component="services-title" style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-4xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", marginBottom: "var(--space-4)", lineHeight: "var(--leading-tight)" }}>전문적인 산후관리 서비스</h2>
            <p data-component="services-subtitle" style={{ fontSize: "var(--text-lg)", color: "var(--color-neutral-500)", maxWidth: "600px", margin: "0 auto", lineHeight: "var(--leading-relaxed)" }}>산모와 아기에게 필요한 모든 케어를 한 곳에서 받으실 수 있습니다.</p>
          </div>
          <div data-component="services-grid" className="services-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-6)" }}>
            {[
              { icon: "\u{1F469}\u200D\u{1F37C}", bg: "var(--color-primary-100)", title: "산모 건강관리", desc: "산후 회복을 위한 전문적인 건강관리와 영양 관리를 제공합니다.", features: ["산후 체조 및 마사지", "영양식 관리 및 상담", "산후 우울증 예방 케어"] },
              { icon: "\u{1F476}", bg: "var(--color-secondary-100)", title: "신생아 돌봄", desc: "신생아의 건강한 성장을 위한 전문 돌봄 서비스입니다.", features: ["신생아 목욕 및 위생 관리", "수유 지원 (모유/분유)", "신생아 건강 체크"] },
              { icon: "\u{1F3E0}", bg: "var(--color-accent-100)", title: "가사 지원", desc: "산모가 편안히 회복할 수 있도록 가사 지원 서비스를 함께 제공합니다.", features: ["식사 준비 및 정리", "세탁 및 청소", "산모 가정환경 관리"] },
            ].map((service, i) => (
              <div key={service.title} data-component="services-grid-card" style={{ background: "var(--color-bg-card)", borderRadius: "var(--radius-md)", padding: "var(--space-8)", boxShadow: "var(--shadow-sm)", transition: "all var(--duration-normal) var(--ease-default)", animation: "fadeInUp var(--duration-normal) var(--ease-out)", animationFillMode: "both", animationDelay: `${i * 100}ms` }}>
                <div aria-hidden="true" style={{ width: "48px", height: "48px", borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", marginBottom: "var(--space-4)", background: service.bg }}>{service.icon}</div>
                <h3 style={{ fontSize: "var(--text-xl)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-800)", marginBottom: "var(--space-3)" }}>{service.title}</h3>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", lineHeight: "var(--leading-relaxed)", marginBottom: "var(--space-4)" }}>{service.desc}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  {service.features.map((f) => (
                    <span key={f} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--color-neutral-600)" }}>
                      <span aria-hidden="true" style={{ color: "var(--color-secondary-500)", fontWeight: "var(--font-bold)" as string }}>&#10003;</span> {f}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section data-component="stats" aria-label="실적 통계" style={{ padding: "var(--space-16) 0", background: "var(--color-primary-500)", color: "white" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div data-component="stats-grid" className="stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-8)", textAlign: "center" }}>
            {[
              { value: "2,500+", label: "누적 서비스 건수" },
              { value: "15년", label: "산후관리 경력" },
              { value: "98%", label: "고객 만족도" },
              { value: "50+", label: "전문 관리사" },
            ].map((stat, i) => (
              <StatDisplay key={stat.label} value={stat.value} label={stat.label} light dataComponent="stats-grid-stat" staggerIndex={i} />
            ))}
          </div>
        </div>
      </section>

      {/* Reviews */}
      <section data-component="reviews" aria-label="고객 후기" style={{ padding: "var(--space-20) 0", background: "var(--color-bg-primary)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div style={{ textAlign: "center", marginBottom: "var(--space-12)", animation: "fadeInUp var(--duration-normal) var(--ease-out)" }}>
            <span style={{ display: "inline-flex", padding: "4px 12px", borderRadius: "var(--radius-full)", fontSize: "var(--text-xs)", fontWeight: "var(--font-medium)" as string, marginBottom: "var(--space-4)", background: "var(--color-accent-100)", color: "var(--color-accent-700)" }} data-component="reviews-badge">고객 후기</span>
            <h2 data-component="reviews-title" style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-4xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", marginBottom: "var(--space-4)", lineHeight: "var(--leading-tight)" }}>엄마들의 생생한 후기</h2>
            <p data-component="reviews-subtitle" style={{ fontSize: "var(--text-lg)", color: "var(--color-neutral-500)", maxWidth: "600px", margin: "0 auto", lineHeight: "var(--leading-relaxed)" }}>아이미래로를 경험한 산모님들의 진심 어린 이야기</p>
          </div>
          <div data-component="reviews-grid" className="reviews-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-6)", marginBottom: "var(--space-10)" }}>
            <TestimonialCard quote="첫째 때도 이용했는데 둘째 때도 역시 아이미래로를 선택했어요. 관리사님이 정말 꼼꼼하고 따뜻하게 케어해주셔서 산후 회복이 빨랐습니다." author="김**" rating={5} date="2025.12" dataComponent="reviews-grid-item" staggerIndex={0} />
            <TestimonialCard quote="정부지원 바우처 신청부터 서비스까지 모든 과정을 친절하게 안내해주셨어요. 신생아 케어가 정말 전문적이었습니다." author="이**" rating={5} date="2025.11" dataComponent="reviews-grid-item" staggerIndex={1} />
            <TestimonialCard quote="산후 우울감이 있었는데 관리사님이 정서적으로도 많이 위로해주시고, 산후 체조도 알려주셔서 몸과 마음 모두 회복할 수 있었어요." author="박**" rating={5} date="2025.10" dataComponent="reviews-grid-item" staggerIndex={2} />
          </div>
          <div style={{ textAlign: "center" }}>
            <a href={EXTERNAL_LINKS.naverBlog} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" dataComponent="reviews-more-button">후기 더 보기 &#8594;</Button>
            </a>
          </div>
        </div>
      </section>

      {/* Training / Certifications */}
      <section data-component="training" aria-label="전문 교육 및 인증" style={{ padding: "var(--space-20) 0", background: "var(--color-secondary-50)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div data-component="training-content" className="training-content" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-12)", alignItems: "center" }}>
            <div style={{ animation: "fadeInUp var(--duration-normal) var(--ease-out)" }}>
              <span style={{ display: "inline-flex", padding: "4px 12px", borderRadius: "var(--radius-full)", fontSize: "var(--text-xs)", fontWeight: "var(--font-medium)" as string, marginBottom: "var(--space-4)", background: "var(--color-secondary-100)", color: "var(--color-secondary-700)" }} data-component="training-badge">전문성</span>
              <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-3xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", marginBottom: "var(--space-4)", lineHeight: "var(--leading-tight)" }}>전문 교육을 받은<br />검증된 관리사</h2>
              <p style={{ fontSize: "var(--text-base)", color: "var(--color-neutral-600)", lineHeight: "var(--leading-relaxed)", marginBottom: "var(--space-6)" }}>아이미래로의 모든 관리사는 체계적인 교육 프로그램을 이수하고, 정기적인 보수교육을 통해 최신 산후관리 기법을 습득합니다.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                {[
                  { icon: "\u{1F393}", text: "산후관리사 국가자격증 보유" },
                  { icon: "\u{1F4DA}", text: "정기 보수교육 및 실무 트레이닝" },
                  { icon: "\u{1FA79}", text: "신생아 응급처치 교육 이수" },
                  { icon: "\u{1F46A}", text: "고객 커뮤니케이션 전문 교육" },
                ].map((item) => (
                  <div key={item.text} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", fontSize: "var(--text-base)", color: "var(--color-neutral-700)" }}>
                    <span aria-hidden="true" style={{ width: "32px", height: "32px", borderRadius: "var(--radius-full)", background: "var(--color-secondary-100)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--text-sm)", flexShrink: 0 }}>{item.icon}</span>
                    <span>{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="training-visual" aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)", animation: "fadeIn var(--duration-slow) var(--ease-out)" }}>
              {[
                { icon: "\u{1F3C6}", title: "우수 사업자\n인증" },
                { icon: "\u{1F4C8}", title: "서비스 품질\n인증" },
                { icon: "\u{1F64B}", title: "전문 관리사\n자격" },
                { icon: "\u{1F499}", title: "고객 만족\n우수상" },
              ].map((cert) => (
                <div key={cert.title} style={{ background: "white", borderRadius: "var(--radius-md)", padding: "var(--space-6)", textAlign: "center", boxShadow: "var(--shadow-sm)" }}>
                  <div style={{ fontSize: "36px", marginBottom: "var(--space-2)" }}>{cert.icon}</div>
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-700)", whiteSpace: "pre-line" }}>{cert.title}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section data-component="cta" aria-label="상담 신청" style={{ padding: "var(--space-20) 0", background: "linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-bg-cream) 100%)", textAlign: "center" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div data-component="cta-content" style={{ maxWidth: "640px", margin: "0 auto", animation: "fadeInUp var(--duration-normal) var(--ease-out)" }}>
            <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-4xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", marginBottom: "var(--space-4)", lineHeight: "var(--leading-tight)" }}>무료 상담으로<br />시작해 보세요</h2>
            <p style={{ fontSize: "var(--text-lg)", color: "var(--color-neutral-600)", marginBottom: "var(--space-8)", lineHeight: "var(--leading-relaxed)" }}>출산 예정일, 필요한 서비스 등을 알려주시면<br />맞춤 상담을 제공해 드립니다.</p>
            <div style={{ display: "flex", gap: "var(--space-4)", justifyContent: "center", flexWrap: "wrap" as const }}>
              <ConsultationCtaButton dataComponent="cta-content-actions-primary">무료 상담 신청</ConsultationCtaButton>
              <Link href="/contact"><Button variant="ghost" size="lg" dataComponent="cta-content-actions-secondary">문의하기</Button></Link>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-lg)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-700)", marginTop: "var(--space-6)", justifyContent: "center" }}>
              <span aria-hidden="true">&#128222;</span>
              <a href="tel:032-442-5992">{COMPANY_INFO.phone}</a>
            </div>
          </div>
        </div>
      </section>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-20px); }
        }
        @media (max-width: 1023px) {
          .hero-container { grid-template-columns: 1fr !important; text-align: center !important; padding-top: var(--space-10) !important; padding-bottom: var(--space-10) !important; }
          .hero-title { font-size: var(--text-4xl) !important; }
          .hero-visual { display: none !important; }
          .quick-actions-grid { grid-template-columns: 1fr !important; max-width: 400px !important; margin: 0 auto !important; }
          .services-grid { grid-template-columns: 1fr !important; max-width: 400px !important; margin: 0 auto !important; }
          .stats-grid { grid-template-columns: repeat(2, 1fr) !important; gap: var(--space-6) !important; }
          .reviews-grid { grid-template-columns: 1fr !important; max-width: 480px !important; margin: 0 auto var(--space-10) !important; }
          .training-content { grid-template-columns: 1fr !important; }
          .training-visual { order: -1 !important; }
        }
        @media (max-width: 767px) {
          .hero-title { font-size: var(--text-3xl) !important; }
          .stats-grid { grid-template-columns: repeat(2, 1fr) !important; gap: var(--space-4) !important; }
          [data-component="hero"] { min-height: auto !important; padding-top: 60px !important; }
        }
      `}</style>
    </>
  );
}
