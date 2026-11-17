import "@/components/app/mobile-redesign/redesign.css";

import { ListCardHeader } from "@/components/app/mobile-redesign/ListCardHeader";
import { AuthCard } from "@/components/auth/auth-card";
import { AuthInlineLink } from "@/components/auth/auth-inline-link";
import { AuthPageLayout } from "@/components/auth/auth-page-layout";

export default function PrivacyPage() {
  return (
    <AuthPageLayout data-component="mobile_privacy_layout">
      <AuthCard
        spacing="legal"
        data-component="mobile_privacy_page"
        data-slot="auth-privacy-page"
      >
        <ListCardHeader
          data-component="mobile_privacy_page_header"
          title="개인정보처리방침"
          count="아가잼잼 어드민"
        />
        <p>아가잼잼 어드민은 산모·신생아 건강관리 서비스 운영에 필요한 최소한의 개인정보만 처리합니다. 수집된 정보는 권한이 있는 지점 담당자에게만 노출되며, 외부에 공유되지 않습니다.</p>
        <AuthInlineLink
          dataComponent="mobile_privacy_page_login-link"
          href="/login"
          linkLabel="로그인으로 돌아가기"
        />
      </AuthCard>
    </AuthPageLayout>
  );
}
