import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui";
import { TestimonialCard } from "@/components/ui/testimonial-card";
import { ConsultationCtaButton } from "@/components/ui/consultation-cta-button";
import { EXTERNAL_LINKS } from "@/types/models";

export const metadata: Metadata = {
  title: "고객 후기 | 인천 아이미래로",
  description: "인천 아이미래로 산후관리 서비스를 이용한 산모님들의 생생한 후기. 고객 만족도 98%, 재이용률 85%.",
};

const reviews = [
  { quote: "첫째 때도 이용했는데 둘째 때도 역시 아이미래로를 선택했어요. 관리사님이 정말 꼼꼼하고 따뜻하게 케어해주셔서 산후 회복이 빨랐습니다. 특히 모유 수유 지도가 정말 도움이 많이 됐어요.", author: "김** 님", date: "2025.12", rating: 5, badge: "프리미엄 15일", badgeColor: "primary" as const },
  { quote: "정부지원 바우처 신청부터 서비스까지 모든 과정을 친절하게 안내해주셨어요. 신생아 케어가 정말 전문적이었고, 아기 목욕도 완벽하게 해주셨습니다.", author: "이** 님", date: "2025.11", rating: 5, badge: "프리미엄 15일", badgeColor: "primary" as const },
  { quote: "산후 우울감이 있었는데 관리사님이 정서적으로도 많이 위로해주시고, 산후 체조도 알려주셔서 몸과 마음 모두 회복할 수 있었어요. 감사합니다.", author: "박** 님", date: "2025.10", rating: 5, badge: "VIP 20일", badgeColor: "secondary" as const },
  { quote: "쌍둥이 출산 후 정말 막막했는데, 관리사님이 두 아이를 능숙하게 돌봐주셔서 큰 힘이 됐어요. 영양식도 맛있게 해주시고, 정말 만족했습니다.", author: "최** 님", date: "2025.09", rating: 5, badge: "프리미엄 15일", badgeColor: "primary" as const },
  { quote: "짧은 기간이었지만 산후 회복에 큰 도움이 됐습니다. 특히 신생아 목욕법을 직접 알려주셔서 서비스 종료 후에도 자신감 있게 할 수 있게 됐어요.", author: "정** 님", date: "2025.08", rating: 5, badge: "스탠다드 10일", badgeColor: "accent" as const },
  { quote: "셋째 출산이라 걱정이 많았는데, 큰 아이들까지 세심하게 챙겨주시는 모습에 감동받았어요. 다음에도 무조건 아이미래로입니다!", author: "한** 님", date: "2025.07", rating: 5, badge: "프리미엄 15일", badgeColor: "primary" as const },
  { quote: "남편이 출장이 잦아서 혼자 출산 후를 보내야 했는데, 관리사님이 든든하게 곁에 있어주셔서 안심이 됐어요. 아이미래로 덕분에 잘 회복했습니다.", author: "윤** 님", date: "2025.06", rating: 4, badge: "스탠다드 10일", badgeColor: "accent" as const },
  { quote: "산후 조리원 대신 집에서 관리받고 싶어서 VIP를 선택했어요. 20일 동안 가정에서 편안하게 회복할 수 있었고, 아기와의 유대감도 더 깊어진 것 같아요.", author: "송** 님", date: "2025.05", rating: 5, badge: "VIP 20일", badgeColor: "secondary" as const },
  { quote: "초보 엄마라 모든 게 처음이었는데, 관리사님이 하나하나 차근차근 알려주셔서 육아에 자신감이 생겼어요. 일일 보고서도 너무 유용했습니다.", author: "장** 님", date: "2025.04", rating: 5, badge: "프리미엄 15일", badgeColor: "primary" as const },
];

export default function ReviewsPage() {

  return (
    <>
      {/* Page Header */}
      <section data-component="reviews-header" style={{ paddingTop: "calc(var(--nav-height) + var(--space-16))", paddingBottom: "var(--space-16)", background: "linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-bg-cream) 100%)", textAlign: "center" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <span data-component="reviews-header-badge" style={{ display: "inline-flex", padding: "4px 12px", borderRadius: "var(--radius-full)", fontSize: "var(--text-xs)", fontWeight: "var(--font-medium)" as string, marginBottom: "var(--space-4)", background: "var(--color-accent-100)", color: "var(--color-accent-700)" }}>Reviews</span>
          <h1 data-component="reviews-header-title" className="page-header-title" style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-5xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", lineHeight: "var(--leading-tight)", marginBottom: "var(--space-4)" }}>고객 후기</h1>
          <p data-component="reviews-header-desc" style={{ fontSize: "var(--text-lg)", color: "var(--color-neutral-500)", maxWidth: "600px", margin: "0 auto", lineHeight: "var(--leading-relaxed)" }}>아이미래로를 경험한 산모님들의 진심 어린 이야기를 확인해 보세요</p>
        </div>
      </section>

      {/* Stats Summary */}
      <section data-component="review-stats" aria-label="후기 통계" style={{ padding: "var(--space-12) 0", background: "var(--color-neutral-0)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div className="review-stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-6)" }}>
            {[
              { value: "4.9", label: "평균 만족도 (5점 만점)" },
              { value: "98%", label: "재이용 의향률" },
              { value: "2,500+", label: "누적 서비스 건수" },
            ].map((stat) => (
              <div key={stat.label} data-component="review-stats-card" style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-neutral-200)", borderRadius: "var(--radius-md)", padding: "var(--space-6)", textAlign: "center" }}>
                <div style={{ fontSize: "var(--text-4xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-primary-500)", marginBottom: "var(--space-2)" }}>{stat.value}</div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-500)" }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Grid */}
      <section data-component="testimonials" aria-label="후기 목록" style={{ padding: "var(--space-12) 0 var(--space-20)", background: "var(--color-neutral-0)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div style={{ textAlign: "center", marginBottom: "var(--space-10)" }}>
            <h2 data-component="testimonials-title" style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-3xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)" }}>산모님들의 이야기</h2>
          </div>
          <div data-component="testimonials-grid" className="testimonials-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-6)", marginBottom: "var(--space-10)" }}>
            {reviews.map((r, i) => (
              <TestimonialCard
                key={i}
                quote={r.quote}
                author={r.author}
                rating={r.rating}
                date={r.date}
                serviceBadge={r.badge}
                serviceBadgeColor={r.badgeColor}
                dataComponent="testimonials-grid-item"
                staggerIndex={i}
              />
            ))}
          </div>
          <div style={{ textAlign: "center" }}>
            <a href={EXTERNAL_LINKS.naverBlog} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" dataComponent="testimonials-more-button">네이버 블로그에서 더 보기 &#8594;</Button>
            </a>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section data-component="cta" aria-label="상담 신청" style={{ padding: "var(--space-20) 0", background: "linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-bg-cream) 100%)", textAlign: "center" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div style={{ maxWidth: "640px", margin: "0 auto", animation: "fadeInUp var(--duration-normal) var(--ease-out)" }}>
            <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-4xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", marginBottom: "var(--space-4)", lineHeight: "var(--leading-tight)" }}>다음 후기의 주인공이<br />되어 보세요</h2>
            <p style={{ fontSize: "var(--text-lg)", color: "var(--color-neutral-600)", marginBottom: "var(--space-8)", lineHeight: "var(--leading-relaxed)" }}>무료 상담을 통해 나에게 맞는 서비스를 알아보세요.</p>
            <div style={{ display: "flex", gap: "var(--space-4)", justifyContent: "center", flexWrap: "wrap" as const }}>
              <ConsultationCtaButton dataComponent="cta-actions-primary">무료 상담 신청</ConsultationCtaButton>
              <Link href="/plan"><Button variant="outline" size="lg" dataComponent="cta-actions-secondary">비용 확인하기</Button></Link>
            </div>
          </div>
        </div>
      </section>

      <style>{`
        @media (max-width: 1023px) {
          .testimonials-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .review-stats-grid { grid-template-columns: 1fr !important; max-width: 400px !important; margin: 0 auto !important; }
          .page-header-title { font-size: var(--text-4xl) !important; }
        }
        @media (max-width: 767px) {
          .testimonials-grid { grid-template-columns: 1fr !important; }
          .page-header-title { font-size: var(--text-3xl) !important; }
        }
      `}</style>
    </>
  );
}
