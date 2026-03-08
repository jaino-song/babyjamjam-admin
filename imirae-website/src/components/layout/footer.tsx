import Link from "next/link";
import { COMPANY_INFO, EXTERNAL_LINKS } from "@/types/models";

export function Footer() {
  return (
    <footer
      data-component="footer"
      role="contentinfo"
      style={{
        background: "var(--color-neutral-800)",
        color: "var(--color-neutral-300)",
        paddingTop: "var(--space-16)",
      }}
    >
      <div
        data-component="footer-container"
        className="footer-grid"
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "0 var(--space-6) var(--space-12)",
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr 1fr",
          gap: "var(--space-10)",
          borderBottom: "1px solid var(--color-neutral-700)",
        }}
      >
        {/* Brand */}
        <div data-component="footer-brand">
          <div
            style={{
              fontSize: "var(--text-xl)",
              fontWeight: "var(--font-bold)" as string,
              color: "var(--color-neutral-0)",
              marginBottom: "var(--space-4)",
            }}
          >
            아이미래로
          </div>
          <p
            style={{
              fontSize: "var(--text-sm)",
              lineHeight: "var(--leading-relaxed)",
              color: "var(--color-neutral-400)",
              marginBottom: "var(--space-4)",
            }}
          >
            인천 남동구에서 산모와 신생아의 건강한 시작을 함께하는 산후관리 전문
            기관입니다.
          </p>
          <div
            data-component="footer-social"
            style={{ display: "flex", gap: "var(--space-3)" }}
          >
            <a
              href={EXTERNAL_LINKS.instagram}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="인스타그램"
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "var(--radius-full)",
                background: "var(--color-neutral-700)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "var(--text-sm)",
                transition: "background var(--duration-fast)",
              }}
            >
              IG
            </a>
            <a
              href={EXTERNAL_LINKS.naverBlog}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="네이버 블로그"
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "var(--radius-full)",
                background: "var(--color-neutral-700)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "var(--text-sm)",
                transition: "background var(--duration-fast)",
              }}
            >
              NB
            </a>
          </div>
        </div>

        {/* Services Links */}
        <div>
          <h4
            style={{
              fontSize: "var(--text-sm)",
              fontWeight: "var(--font-semibold)" as string,
              color: "var(--color-neutral-0)",
              marginBottom: "var(--space-4)",
              textTransform: "uppercase" as const,
              letterSpacing: "0.05em",
            }}
          >
            서비스
          </h4>
          <nav
            style={{
              display: "flex",
              flexDirection: "column" as const,
              gap: "var(--space-3)",
            }}
          >
            <Link href="/program" style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-400)" }}>산후관리서비스</Link>
            <Link href="/plan" style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-400)" }}>비용 안내</Link>
            <Link href="/reviews" style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-400)" }}>고객 후기</Link>
            <Link href="/contact" style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-400)" }}>문의하기</Link>
          </nav>
        </div>

        {/* Company Links */}
        <div>
          <h4
            style={{
              fontSize: "var(--text-sm)",
              fontWeight: "var(--font-semibold)" as string,
              color: "var(--color-neutral-0)",
              marginBottom: "var(--space-4)",
              textTransform: "uppercase" as const,
              letterSpacing: "0.05em",
            }}
          >
            회사
          </h4>
          <nav
            style={{
              display: "flex",
              flexDirection: "column" as const,
              gap: "var(--space-3)",
            }}
          >
            <Link href="/introduction" style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-400)" }}>회사 소개</Link>
            <Link href="/disclaimer" style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-400)" }}>이용약관</Link>
          </nav>
        </div>

        {/* Contact Info */}
        <div>
          <h4
            style={{
              fontSize: "var(--text-sm)",
              fontWeight: "var(--font-semibold)" as string,
              color: "var(--color-neutral-0)",
              marginBottom: "var(--space-4)",
              textTransform: "uppercase" as const,
              letterSpacing: "0.05em",
            }}
          >
            연락처
          </h4>
          <div style={{ display: "flex", flexDirection: "column" as const, gap: "var(--space-3)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--color-neutral-400)", lineHeight: "var(--leading-relaxed)" }}>
              <span aria-hidden="true">&#128222;</span>
              <span>{COMPANY_INFO.phone}</span>
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--color-neutral-400)", lineHeight: "var(--leading-relaxed)" }}>
              <span aria-hidden="true">&#9993;</span>
              <span>{COMPANY_INFO.email}</span>
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--color-neutral-400)", lineHeight: "var(--leading-relaxed)" }}>
              <span aria-hidden="true">&#128205;</span>
              <span>{COMPANY_INFO.address}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom */}
      <div
        data-component="footer-bottom"
        className="footer-bottom"
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "var(--space-6)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <p style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
          &copy; 2026 {COMPANY_INFO.name}. All rights reserved.
        </p>
        <div style={{ display: "flex", gap: "var(--space-4)" }}>
          <Link href="/disclaimer" style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
            이용약관
          </Link>
          <Link href="/disclaimer" style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral-500)" }}>
            개인정보처리방침
          </Link>
        </div>
      </div>

      <style>{`
        @media (max-width: 1023px) {
          .footer-grid { grid-template-columns: 1fr 1fr !important; gap: var(--space-8) !important; }
        }
        @media (max-width: 767px) {
          .footer-grid { grid-template-columns: 1fr !important; }
          .footer-bottom { flex-direction: column !important; gap: var(--space-4) !important; text-align: center !important; }
        }
      `}</style>
    </footer>
  );
}
