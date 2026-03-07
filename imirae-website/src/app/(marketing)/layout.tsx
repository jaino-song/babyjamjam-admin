"use client";

import { useState, useEffect, useCallback } from "react";
import { NavigationBar } from "@/components/layout/navigation-bar";
import { Footer } from "@/components/layout/footer";
import { ConsultationModal } from "@/components/features/consultation-modal";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [consultationOpen, setConsultationOpen] = useState(false);

  const openConsultation = useCallback(() => setConsultationOpen(true), []);

  useEffect(() => {
    window.addEventListener("open-consultation", openConsultation);
    return () => window.removeEventListener("open-consultation", openConsultation);
  }, [openConsultation]);

  return (
    <>
      <a
        href="#main-content"
        data-component="skip-link"
        style={{
          position: "absolute",
          top: "-100%",
          left: "var(--space-4)",
          padding: "var(--space-2) var(--space-4)",
          background: "var(--color-primary-500)",
          color: "white",
          borderRadius: "var(--radius-md)",
          zIndex: 1000,
          fontSize: "var(--text-sm)",
        }}
        onFocus={(e) => {
          (e.target as HTMLElement).style.top = "var(--space-4)";
        }}
        onBlur={(e) => {
          (e.target as HTMLElement).style.top = "-100%";
        }}
      >
        본문으로 건너뛰기
      </a>
      <NavigationBar onConsultationClick={() => setConsultationOpen(true)} />
      <main id="main-content">{children}</main>
      <Footer />
      <ConsultationModal
        open={consultationOpen}
        onClose={() => setConsultationOpen(false)}
      />
    </>
  );
}
