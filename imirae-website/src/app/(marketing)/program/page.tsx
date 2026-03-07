import type { Metadata } from "next";
import Link from "next/link";
import { Button, Badge } from "@/components/ui";
import { ConsultationCtaButton } from "@/components/ui/consultation-cta-button";

export const metadata: Metadata = {
  title: "산후관리 서비스 | 인천 아이미래로",
  description: "산모 건강관리, 신생아 돌봄, 가사 지원 서비스를 소개합니다. 전문 관리사가 체계적인 일일 케어 프로그램으로 산모와 아기를 돌봅니다.",
};

export default function ProgramPage() {

  const services = [
    {
      badge: { label: "산모 케어", variant: "primary" as const },
      title: "산모 건강관리",
      desc: "출산 후 산모의 신체적, 정서적 회복을 전문적으로 돕습니다. 체계적인 산후 건강관리 프로그램을 통해 빠르고 건강한 회복을 지원합니다.",
      features: [
        { icon: "\u{1F4AA}", bg: "var(--color-primary-100)", title: "산후 체조 및 마사지", desc: "자궁 수축, 혈액 순환 촉진, 근육 이완을 위한 전문 산후 체조와 마사지를 제공합니다." },
        { icon: "\u{1F372}", bg: "var(--color-secondary-100)", title: "영양식 관리", desc: "산모의 체력 회복과 모유 수유를 위한 균형 잡힌 영양식을 준비하고, 맞춤 영양 상담을 진행합니다." },
        { icon: "\u{1F49C}", bg: "var(--color-accent-100)", title: "산후 우울증 예방", desc: "정서적 안정을 위한 상담과 돌봄으로 산후 우울증을 사전에 예방하고 관리합니다." },
      ],
      visual: { bg: "linear-gradient(135deg,var(--color-primary-100),var(--color-primary-50))", emoji: "\u{1F469}\u200D\u{1F37C}" },
      component: "program-service-1",
      reversed: false,
    },
    {
      badge: { label: "신생아 케어", variant: "secondary" as const },
      title: "신생아 돌봄",
      desc: "전문 관리사가 신생아의 건강하고 안전한 성장을 위해 세심하게 돌봅니다. 초보 엄마도 안심할 수 있는 체계적인 신생아 케어를 제공합니다.",
      features: [
        { icon: "\u{1F6C0}", bg: "var(--color-secondary-100)", title: "신생아 목욕 및 위생관리", desc: "안전하고 위생적인 목욕법과 배꼽 관리, 피부 관리 등 전문적인 위생 케어를 제공합니다." },
        { icon: "\u{1F37C}", bg: "var(--color-primary-100)", title: "수유 지원", desc: "모유 수유 자세 교정, 분유 수유 관리, 수유량 체크 등 수유 전반에 걸친 지원을 합니다." },
        { icon: "\u{1F48B}", bg: "var(--color-accent-100)", title: "건강 체크 및 관찰", desc: "체온, 수면 패턴, 대소변 확인 등 신생아의 건강 상태를 꼼꼼히 체크하고 기록합니다." },
      ],
      visual: { bg: "linear-gradient(135deg,var(--color-secondary-100),var(--color-secondary-50))", emoji: "\u{1F476}" },
      component: "program-service-2",
      reversed: true,
    },
    {
      badge: { label: "가사 지원", variant: "accent" as const },
      title: "가사 지원 서비스",
      desc: "산모가 오로지 회복에만 집중할 수 있도록, 일상 가사를 함께 지원합니다. 깨끗하고 편안한 환경에서 건강하게 회복하실 수 있습니다.",
      features: [
        { icon: "\u{1F373}", bg: "var(--color-accent-100)", title: "식사 준비", desc: "산모에게 필요한 영양을 고려한 식사를 준비하고, 설거지 및 주방 정리를 지원합니다." },
        { icon: "\u{1F455}", bg: "var(--color-primary-100)", title: "세탁 및 청소", desc: "산모와 신생아의 세탁물을 관리하고, 생활 공간을 깨끗하게 유지합니다." },
        { icon: "\u{1F3E0}", bg: "var(--color-secondary-100)", title: "가정환경 관리", desc: "신생아에게 안전하고 위생적인 환경을 유지할 수 있도록 가정환경을 관리합니다." },
      ],
      visual: { bg: "linear-gradient(135deg,var(--color-accent-100),var(--color-accent-50))", emoji: "\u{1F3E0}" },
      component: "program-service-3",
      reversed: false,
    },
  ];

  const scheduleData = [
    { time: "09:00", activity: "출근 및 컨디션 확인", category: "산모", categoryVariant: "primary" as const, detail: "산모 건강 상태 확인, 하루 일정 공유" },
    { time: "09:30", activity: "신생아 케어", category: "신생아", categoryVariant: "secondary" as const, detail: "신생아 목욕, 배꼽 소독, 체온 확인" },
    { time: "10:30", activity: "산모 식사 준비", category: "가사", categoryVariant: "accent" as const, detail: "영양식 조리, 간식 준비" },
    { time: "11:30", activity: "수유 지원", category: "신생아", categoryVariant: "secondary" as const, detail: "모유/분유 수유 보조, 트림 시키기" },
    { time: "12:00", activity: "점심 식사", category: "가사", categoryVariant: "accent" as const, detail: "산모 점심 식사 준비 및 설거지" },
    { time: "13:00", activity: "산후 체조", category: "산모", categoryVariant: "primary" as const, detail: "산후 회복 체조, 스트레칭 지도" },
    { time: "14:00", activity: "세탁 및 청소", category: "가사", categoryVariant: "accent" as const, detail: "아기 빨래, 생활 공간 정리" },
    { time: "15:00", activity: "신생아 케어", category: "신생아", categoryVariant: "secondary" as const, detail: "수유, 기저귀 교체, 건강 관찰" },
    { time: "16:00", activity: "간식 준비 및 상담", category: "산모", categoryVariant: "primary" as const, detail: "산모 간식 준비, 육아 상담" },
    { time: "17:00", activity: "저녁 준비 및 인수인계", category: "가사", categoryVariant: "accent" as const, detail: "저녁 식사 준비, 일일 보고서 작성" },
  ];

  return (
    <>
      {/* Page Header */}
      <section data-component="program-header" style={{ paddingTop: "calc(var(--nav-height) + var(--space-16))", paddingBottom: "var(--space-16)", background: "linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-bg-cream) 100%)", textAlign: "center" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <span data-component="program-header-badge" style={{ display: "inline-flex", padding: "4px 12px", borderRadius: "var(--radius-full)", fontSize: "var(--text-xs)", fontWeight: "var(--font-medium)" as string, marginBottom: "var(--space-4)", background: "var(--color-primary-100)", color: "var(--color-primary-700)" }}>Our Service</span>
          <h1 data-component="program-header-title" className="page-header-title" style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-5xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", lineHeight: "var(--leading-tight)", marginBottom: "var(--space-4)" }}>산후관리서비스</h1>
          <p data-component="program-header-desc" style={{ fontSize: "var(--text-lg)", color: "var(--color-neutral-500)", maxWidth: "600px", margin: "0 auto", lineHeight: "var(--leading-relaxed)" }}>산모와 신생아를 위한 전문적이고 따뜻한 맞춤 케어를 제공합니다</p>
        </div>
      </section>

      {/* Service Sections */}
      {services.map((service, sIdx) => (
        <section key={service.component} data-component={service.component} aria-label={service.title} style={{ padding: "var(--space-20) 0", background: sIdx % 2 === 0 ? "var(--color-neutral-0)" : "var(--color-bg-cream)" }}>
          <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
            <div className="service-layout" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-12)", alignItems: "center" }}>
              <div style={{ order: service.reversed ? 1 : 0, animation: "fadeInUp var(--duration-normal) var(--ease-out)" }}>
                <Badge variant={service.badge.variant} size="sm" dataComponent={`${service.component}-badge`}>{service.badge.label}</Badge>
                <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-3xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", margin: "var(--space-4) 0", lineHeight: "var(--leading-tight)" }}>{service.title}</h2>
                <p style={{ fontSize: "var(--text-base)", color: "var(--color-neutral-600)", lineHeight: "var(--leading-relaxed)", marginBottom: "var(--space-6)" }}>{service.desc}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
                  {service.features.map((feature) => (
                    <div key={feature.title} style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-start" }}>
                      <div aria-hidden="true" style={{ width: "48px", height: "48px", borderRadius: "var(--radius-md)", background: feature.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", flexShrink: 0 }}>{feature.icon}</div>
                      <div>
                        <h4 style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-800)", marginBottom: "var(--space-1)" }}>{feature.title}</h4>
                        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", lineHeight: "var(--leading-relaxed)" }}>{feature.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div aria-hidden="true" style={{ order: service.reversed ? 0 : 1, display: "flex", justifyContent: "center", animation: "fadeIn var(--duration-slow) var(--ease-out)" }}>
                <div style={{ width: "100%", maxWidth: "400px", aspectRatio: "1", borderRadius: "var(--radius-xl)", background: service.visual.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "120px" }}>{service.visual.emoji}</div>
              </div>
            </div>
          </div>
        </section>
      ))}

      {/* Service Process */}
      <section data-component="process" aria-label="서비스 이용 절차" style={{ padding: "var(--space-20) 0", background: "var(--color-bg-secondary)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div style={{ textAlign: "center", marginBottom: "var(--space-12)" }}>
            <span data-component="process-badge" style={{ display: "inline-flex", padding: "4px 12px", borderRadius: "var(--radius-full)", fontSize: "var(--text-xs)", fontWeight: "var(--font-medium)" as string, marginBottom: "var(--space-4)", background: "var(--color-primary-100)", color: "var(--color-primary-700)" }}>이용 절차</span>
            <h2 data-component="process-title" style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-4xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", marginBottom: "var(--space-4)", lineHeight: "var(--leading-tight)" }}>서비스 이용 방법</h2>
            <p data-component="process-subtitle" style={{ fontSize: "var(--text-lg)", color: "var(--color-neutral-500)", maxWidth: "600px", margin: "0 auto", lineHeight: "var(--leading-relaxed)" }}>간단한 4단계로 전문 산후관리 서비스를 이용하실 수 있습니다</p>
          </div>
          <div className="process-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-6)" }}>
            {[
              { num: "1", icon: "\u{1F4DE}", title: "상담 신청", desc: "전화 또는 온라인으로 무료 상담을 신청해 주세요." },
              { num: "2", icon: "\u{1F4CB}", title: "맞춤 상담", desc: "출산 예정일과 필요 서비스를 파악하여 맞춤 케어 플랜을 제안합니다." },
              { num: "3", icon: "\u{1F91D}", title: "관리사 매칭", desc: "경력과 전문성을 고려하여 최적의 관리사를 매칭해 드립니다." },
              { num: "4", icon: "\u{1F496}", title: "서비스 시작", desc: "출산 후 가정에 방문하여 전문 산후관리 서비스를 시작합니다." },
            ].map((step, i) => (
              <div key={step.num} data-component="process-grid-card" style={{ background: "var(--color-bg-card)", borderRadius: "var(--radius-md)", padding: "var(--space-6)", textAlign: "center", boxShadow: "var(--shadow-sm)", animation: "fadeInUp var(--duration-normal) var(--ease-out)", animationFillMode: "both", animationDelay: `${i * 100}ms` }}>
                <div style={{ width: "32px", height: "32px", borderRadius: "var(--radius-full)", background: "var(--color-primary-500)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--text-sm)", fontWeight: "var(--font-bold)" as string, margin: "0 auto var(--space-3)" }}>{step.num}</div>
                <div aria-hidden="true" style={{ fontSize: "32px", marginBottom: "var(--space-3)" }}>{step.icon}</div>
                <h3 style={{ fontSize: "var(--text-lg)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-800)", marginBottom: "var(--space-2)" }}>{step.title}</h3>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)", lineHeight: "var(--leading-relaxed)" }}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Daily Schedule */}
      <section data-component="schedule" aria-label="하루 일과" style={{ padding: "var(--space-20) 0", background: "var(--color-neutral-0)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div style={{ textAlign: "center", marginBottom: "var(--space-12)" }}>
            <span data-component="schedule-badge" style={{ display: "inline-flex", padding: "4px 12px", borderRadius: "var(--radius-full)", fontSize: "var(--text-xs)", fontWeight: "var(--font-medium)" as string, marginBottom: "var(--space-4)", background: "var(--color-secondary-100)", color: "var(--color-secondary-700)" }}>일일 스케줄</span>
            <h2 data-component="schedule-title" style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-4xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", marginBottom: "var(--space-4)", lineHeight: "var(--leading-tight)" }}>관리사의 하루 일과</h2>
            <p data-component="schedule-subtitle" style={{ fontSize: "var(--text-lg)", color: "var(--color-neutral-500)", maxWidth: "600px", margin: "0 auto", lineHeight: "var(--leading-relaxed)" }}>체계적인 시간 관리로 산모와 신생아를 꼼꼼히 돌봅니다</p>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table data-component="schedule-table" style={{ width: "100%", borderCollapse: "collapse", background: "var(--color-bg-card)", borderRadius: "var(--radius-md)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
              <thead>
                <tr style={{ background: "var(--color-neutral-50)" }}>
                  <th style={{ padding: "var(--space-4)", textAlign: "left", fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-600)", borderBottom: "2px solid var(--color-neutral-200)" }}>시간</th>
                  <th style={{ padding: "var(--space-4)", textAlign: "left", fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-600)", borderBottom: "2px solid var(--color-neutral-200)" }}>활동</th>
                  <th style={{ padding: "var(--space-4)", textAlign: "left", fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-600)", borderBottom: "2px solid var(--color-neutral-200)" }}>분류</th>
                  <th style={{ padding: "var(--space-4)", textAlign: "left", fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-600)", borderBottom: "2px solid var(--color-neutral-200)" }}>상세 내용</th>
                </tr>
              </thead>
              <tbody>
                {scheduleData.map((row) => (
                  <tr key={row.time} style={{ borderBottom: "1px solid var(--color-neutral-100)" }}>
                    <td style={{ padding: "var(--space-4)", fontSize: "var(--text-sm)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-primary-600)" }}>{row.time}</td>
                    <td style={{ padding: "var(--space-4)", fontSize: "var(--text-sm)", color: "var(--color-neutral-700)" }}>{row.activity}</td>
                    <td style={{ padding: "var(--space-4)" }}><Badge variant={row.categoryVariant} size="sm">{row.category}</Badge></td>
                    <td style={{ padding: "var(--space-4)", fontSize: "var(--text-sm)", color: "var(--color-neutral-500)" }}>{row.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section data-component="cta" aria-label="상담 신청" style={{ padding: "var(--space-20) 0", background: "linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-bg-cream) 100%)", textAlign: "center" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div style={{ maxWidth: "640px", margin: "0 auto", animation: "fadeInUp var(--duration-normal) var(--ease-out)" }}>
            <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-4xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", marginBottom: "var(--space-4)", lineHeight: "var(--leading-tight)" }}>전문 산후관리 서비스를<br />경험해 보세요</h2>
            <p style={{ fontSize: "var(--text-lg)", color: "var(--color-neutral-600)", marginBottom: "var(--space-8)", lineHeight: "var(--leading-relaxed)" }}>무료 상담을 통해 맞춤 케어 플랜을 안내받으실 수 있습니다.</p>
            <div style={{ display: "flex", gap: "var(--space-4)", justifyContent: "center", flexWrap: "wrap" as const }}>
              <ConsultationCtaButton dataComponent="cta-actions-primary">무료 상담 신청</ConsultationCtaButton>
              <Link href="/plan"><Button variant="outline" size="lg" dataComponent="cta-actions-secondary">비용 확인하기</Button></Link>
            </div>
          </div>
        </div>
      </section>

      <style>{`
        @media (max-width: 1023px) {
          .service-layout { grid-template-columns: 1fr !important; }
          .service-layout > div { order: 0 !important; }
          .process-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .page-header-title { font-size: var(--text-4xl) !important; }
        }
        @media (max-width: 767px) {
          .process-grid { grid-template-columns: 1fr !important; }
          .page-header-title { font-size: var(--text-3xl) !important; }
        }
      `}</style>
    </>
  );
}
