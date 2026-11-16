import "@/components/app/mobile-redesign/redesign.css";

import { AuthCard } from "@/components/auth/auth-card";
import { AuthInlineLink } from "@/components/auth/auth-inline-link";
import { AuthPageLayout } from "@/components/auth/auth-page-layout";

export default function TermsPage() {
  return (
    <AuthPageLayout data-component="mobile_terms_layout">
      <AuthCard
        data-component="mobile_terms_page"
        data-slot="auth-terms-page"
        title="이용약관"
        description="아가잼잼 어드민"
      >
        <p>아가잼잼 어드민은 산모·신생아 건강관리 서비스의 운영과 고객 응대를 위한 도구입니다. 지점 운영, 고객 관리, 계약서 발송 기능은 승인된 관리자 계정으로만 사용할 수 있습니다.</p>
        <AuthInlineLink
          dataComponent="mobile_terms_page_login-link"
          href="/login"
          linkLabel="로그인으로 돌아가기"
        />
      </AuthCard>
    </AuthPageLayout>
  );
}
