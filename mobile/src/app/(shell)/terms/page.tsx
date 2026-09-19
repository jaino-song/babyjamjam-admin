import "@/components/app/mobile-redesign/redesign.css";

import Link from "next/link";

export default function TermsPage() {
  return (
    <section
      className="shell-content flex flex-col"
      data-component="mobile_terms_page"
    >
      <div className="list-card">
        <div className="list-title">
          <span className="list-title-text">
            이용약관
            <span className="list-count">아가잼잼 어드민</span>
          </span>
        </div>
        <div className="list-card-scroll space-y-3 px-4 py-4 text-[0.85rem] leading-relaxed text-v3-dark">
          <p>
            현재 이 페이지에는 이용약관 전문이 등록되어 있지 않습니다.
          </p>
        </div>
      </div>
      <div className="px-4 pt-4 text-center text-[0.78rem] text-v3-primary">
        <Link className="-mx-3 inline-flex min-h-[44px] items-center px-3" href="/login">
          로그인으로 돌아가기
        </Link>
      </div>
    </section>
  );
}
