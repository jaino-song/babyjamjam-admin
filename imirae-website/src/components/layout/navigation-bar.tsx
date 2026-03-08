"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/types/models";

interface NavigationBarProps {
  onConsultationClick: () => void;
}

export function NavigationBar({ onConsultationClick }: NavigationBarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const closeMobile = () => setMobileOpen(false);

  return (
    <nav
      data-component="nav"
      role="navigation"
      aria-label="주 내비게이션"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "var(--nav-height)",
        background: "rgba(255, 255, 255, 0.95)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid var(--color-neutral-200)",
        zIndex: 100,
        boxShadow: scrolled ? "var(--shadow-sm)" : "none",
        animation: "fadeIn var(--duration-normal) var(--ease-out)",
      }}
    >
      <div
        data-component="nav-container"
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "0 var(--space-6)",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link
          href="/"
          data-component="nav-logo"
          aria-label="인천 아이미래로 홈"
          style={{
            fontSize: "var(--text-xl)",
            fontWeight: "var(--font-bold)" as string,
            color: "var(--color-primary-600)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: "36px",
              height: "36px",
              background: "var(--color-primary-500)",
              borderRadius: "var(--radius-md)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: "var(--text-lg)",
            }}
          >
            &#9829;
          </span>
          아이미래로
        </Link>

        {/* Desktop Links */}
        <ul
          data-component="nav-links"
          style={{
            display: "flex",
            gap: "var(--space-1)",
          }}
          className="nav-links-desktop"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <li
                key={item.href}
                data-component="nav-links-item"
                className={isActive ? "active" : ""}
              >
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  style={{
                    display: "block",
                    padding: "var(--space-2) var(--space-4)",
                    fontSize: "var(--text-base)",
                    fontWeight: "var(--font-medium)" as string,
                    color: isActive
                      ? "var(--color-primary-600)"
                      : "var(--color-neutral-600)",
                    background: isActive ? "var(--color-primary-50)" : "transparent",
                    borderRadius: "var(--radius-md)",
                    transition: "all var(--duration-fast) var(--ease-default)",
                  }}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Desktop CTA */}
        <button
          data-component="nav-cta"
          onClick={onConsultationClick}
          className="nav-cta-desktop"
          style={{
            background: "var(--color-primary-500)",
            color: "white",
            padding: "10px 20px",
            borderRadius: "var(--radius-md)",
            fontSize: "var(--text-sm)",
            fontWeight: "var(--font-semibold)" as string,
            transition: "all var(--duration-fast) var(--ease-default)",
          }}
        >
          상담 신청
        </button>

        {/* Mobile Toggle */}
        <button
          data-component="nav-mobile-toggle"
          aria-label={mobileOpen ? "메뉴 닫기" : "메뉴 열기"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(!mobileOpen)}
          className="nav-mobile-toggle"
          style={{
            width: "44px",
            height: "44px",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--radius-md)",
            color: "var(--color-neutral-700)",
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            {mobileOpen ? (
              <>
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="6" y1="18" x2="18" y2="6" />
              </>
            ) : (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div
          data-component="nav-mobile-menu"
          style={{
            background: "var(--color-neutral-0)",
            borderTop: "1px solid var(--color-neutral-200)",
            padding: "var(--space-4) var(--space-6)",
            boxShadow: "var(--shadow-lg)",
            animation: "fadeIn var(--duration-fast) var(--ease-out)",
          }}
        >
          <ul style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={closeMobile}
                    aria-current={isActive ? "page" : undefined}
                    style={{
                      display: "block",
                      padding: "var(--space-3) var(--space-4)",
                      fontSize: "var(--text-base)",
                      fontWeight: "var(--font-medium)" as string,
                      color: isActive
                        ? "var(--color-primary-600)"
                        : "var(--color-neutral-600)",
                      background: isActive ? "var(--color-primary-50)" : "transparent",
                      borderRadius: "var(--radius-md)",
                    }}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <button
            onClick={() => { closeMobile(); onConsultationClick(); }}
            style={{
              width: "100%",
              marginTop: "var(--space-4)",
              background: "var(--color-primary-500)",
              color: "white",
              padding: "12px 24px",
              borderRadius: "var(--radius-md)",
              fontSize: "var(--text-base)",
              fontWeight: "var(--font-semibold)" as string,
            }}
          >
            상담 신청
          </button>
        </div>
      )}

      <style>{`
        @media (max-width: 1023px) {
          .nav-links-desktop, .nav-cta-desktop { display: none !important; }
          .nav-mobile-toggle { display: flex !important; }
        }
        @media (min-width: 1024px) {
          .nav-mobile-toggle { display: none !important; }
        }
      `}</style>
    </nav>
  );
}
