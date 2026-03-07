import type { Metadata } from "next";
import { COMPANY_INFO } from "@/types/models";

export const metadata: Metadata = {
  title: "이용약관 | 인천 아이미래로",
  description: "인천 아이미래로 산후관리 서비스 이용약관. 서비스 내용, 비용, 환불 정책, 개인정보처리방침 등을 확인하세요.",
};

const articles = [
  { id: "article-1", title: "제1조 (목적)", content: <p>본 약관은 인천 아이미래로(이하 &quot;회사&quot;)가 제공하는 산후관리 서비스의 이용에 관한 기본적인 사항을 규정함을 목적으로 합니다.</p> },
  { id: "article-2", title: "제2조 (용어의 정의)", content: <ol style={{ paddingLeft: "var(--space-6)", display: "flex", flexDirection: "column" as const, gap: "var(--space-2)" }}><li>&quot;서비스&quot;란 회사가 제공하는 산모\xB7신생아 건강관리 서비스를 말합니다.</li><li>&quot;이용자&quot;란 본 약관에 동의하고 서비스를 이용하는 자를 말합니다.</li><li>&quot;관리사&quot;란 회사에 소속되어 산후관리 서비스를 직접 제공하는 전문 인력을 말합니다.</li><li>&quot;정부지원 바우처&quot;란 산모\xB7신생아 건강관리 지원사업에 따라 정부가 지원하는 서비스 이용권을 말합니다.</li></ol> },
  { id: "article-3", title: "제3조 (서비스의 내용)", content: <><p>회사가 제공하는 서비스의 내용은 다음과 같습니다.</p><ol style={{ paddingLeft: "var(--space-6)", display: "flex", flexDirection: "column" as const, gap: "var(--space-2)", marginTop: "var(--space-2)" }}><li>산모 건강관리: 산후 체조, 마사지, 영양식 관리, 산후 우울증 예방 케어</li><li>신생아 돌봄: 목욕, 수유 지원, 건강 체크, 위생 관리</li><li>가사 지원: 식사 준비, 세탁, 청소, 가정환경 관리</li></ol></> },
  { id: "article-4", title: "제4조 (서비스 이용 계약)", content: <ol style={{ paddingLeft: "var(--space-6)", display: "flex", flexDirection: "column" as const, gap: "var(--space-2)" }}><li>서비스 이용 계약은 이용자가 회사에 서비스 이용을 신청하고, 회사가 이를 승낙함으로써 성립합니다.</li><li>이용자는 상담을 통해 서비스 유형, 기간, 시작일 등을 결정합니다.</li><li>회사는 관리사 배정 상황에 따라 서비스 시작일을 조정할 수 있습니다.</li></ol> },
  { id: "article-5", title: "제5조 (서비스 비용 및 결제)", content: <ol style={{ paddingLeft: "var(--space-6)", display: "flex", flexDirection: "column" as const, gap: "var(--space-2)" }}><li>서비스 비용은 회사가 정한 요금표에 따릅니다.</li><li>정부지원 바우처를 사용하는 경우, 본인부담금은 소득 구간에 따라 차등 적용됩니다.</li><li>결제는 계좌이체, 카드결제, 국민행복카드로 가능합니다.</li><li>서비스 시작 전 전액 결제를 원칙으로 하며, 분할 결제는 상담 시 협의합니다.</li></ol> },
  { id: "article-6", title: "제6조 (취소 및 환불)", content: <ol style={{ paddingLeft: "var(--space-6)", display: "flex", flexDirection: "column" as const, gap: "var(--space-2)" }}><li>서비스 시작 전 취소 시 전액 환불합니다.</li><li>서비스 이용 중 취소 시 남은 일수에 대해 일할 계산하여 환불합니다.</li><li>이용자의 귀책 사유로 인한 서비스 중단 시 환불 금액에서 위약금(잔여 서비스 비용의 10%)을 공제할 수 있습니다.</li><li>천재지변 등 불가항력적 사유로 인한 서비스 중단 시 전액 환불합니다.</li></ol> },
  { id: "article-7", title: "제7조 (이용자의 의무)", content: <ol style={{ paddingLeft: "var(--space-6)", display: "flex", flexDirection: "column" as const, gap: "var(--space-2)" }}><li>이용자는 관리사에게 안전한 서비스 환경을 제공해야 합니다.</li><li>이용자는 서비스 일정 변경 시 최소 24시간 전에 회사에 통보해야 합니다.</li><li>이용자는 관리사에게 계약 범위 외의 업무를 요구할 수 없습니다.</li><li>이용자는 관리사에 대한 부당한 대우나 폭언, 폭행 등을 해서는 안 됩니다.</li></ol> },
  { id: "article-8", title: "제8조 (회사의 의무)", content: <ol style={{ paddingLeft: "var(--space-6)", display: "flex", flexDirection: "column" as const, gap: "var(--space-2)" }}><li>회사는 자격을 갖춘 전문 관리사를 배정하여 양질의 서비스를 제공합니다.</li><li>회사는 관리사에 대한 정기적인 교육과 관리를 실시합니다.</li><li>회사는 서비스 제공 중 발생한 문제에 대해 신속하게 대응합니다.</li><li>관리사의 사유로 서비스가 중단될 경우, 회사는 대체 관리사를 배정합니다.</li></ol> },
  { id: "article-9", title: "제9조 (개인정보 보호)", content: <ol style={{ paddingLeft: "var(--space-6)", display: "flex", flexDirection: "column" as const, gap: "var(--space-2)" }}><li>회사는 이용자의 개인정보를 &laquo;개인정보보호법&raquo;에 따라 보호합니다.</li><li>수집하는 개인정보: 성명, 연락처, 주소, 출산 예정일 등 서비스 제공에 필요한 정보</li><li>수집된 개인정보는 서비스 제공 목적으로만 사용하며, 이용자의 동의 없이 제3자에게 제공하지 않습니다.</li><li>이용자는 언제든지 자신의 개인정보에 대한 열람, 수정, 삭제를 요청할 수 있습니다.</li></ol> },
  { id: "article-10", title: "제10조 (면책 사항)", content: <ol style={{ paddingLeft: "var(--space-6)", display: "flex", flexDirection: "column" as const, gap: "var(--space-2)" }}><li>회사는 천재지변, 전쟁, 감염병 대유행 등 불가항력적 사유로 서비스를 제공하지 못하는 경우 책임을 지지 않습니다.</li><li>이용자의 고의 또는 과실로 발생한 손해에 대해 회사는 책임을 지지 않습니다.</li><li>본 약관에 명시되지 않은 사항은 관련 법령 및 상관례에 따릅니다.</li></ol> },
];

export default function DisclaimerPage() {
  return (
    <>
      {/* Page Header */}
      <section data-component="terms-header" style={{ paddingTop: "calc(var(--nav-height) + var(--space-16))", paddingBottom: "var(--space-16)", background: "linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-bg-cream) 100%)", textAlign: "center" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <span data-component="terms-header-badge" style={{ display: "inline-flex", padding: "4px 12px", borderRadius: "var(--radius-full)", fontSize: "var(--text-xs)", fontWeight: "var(--font-medium)" as string, marginBottom: "var(--space-4)", background: "var(--color-primary-100)", color: "var(--color-primary-700)" }}>Legal</span>
          <h1 data-component="terms-header-title" style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-5xl)", fontWeight: "var(--font-bold)" as string, color: "var(--color-neutral-900)", lineHeight: "var(--leading-tight)", marginBottom: "var(--space-4)" }}>이용약관</h1>
          <p data-component="terms-header-desc" style={{ fontSize: "var(--text-lg)", color: "var(--color-neutral-500)" }}>인천 아이미래로 서비스 이용에 관한 약관입니다</p>
        </div>
      </section>

      {/* Terms Content */}
      <section data-component="terms" aria-label="이용약관" style={{ padding: "var(--space-20) 0", background: "var(--color-neutral-0)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 var(--space-6)" }}>
          <div style={{ maxWidth: "800px", margin: "0 auto" }}>
            {/* Table of Contents */}
            <div data-component="terms-toc" style={{ background: "var(--color-neutral-50)", borderRadius: "var(--radius-md)", padding: "var(--space-6)", marginBottom: "var(--space-10)" }}>
              <div style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-800)", marginBottom: "var(--space-4)" }}>목차</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                {articles.map((a, i) => (
                  <a key={a.id} href={`#${a.id}`} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", fontSize: "var(--text-sm)", color: "var(--color-neutral-600)", padding: "var(--space-1) 0" }}>
                    <span style={{ width: "24px", height: "24px", borderRadius: "var(--radius-full)", background: "var(--color-primary-100)", color: "var(--color-primary-600)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--text-xs)", fontWeight: "var(--font-semibold)" as string, flexShrink: 0 }}>{i + 1}</span>
                    <span>{a.title.replace(/제\d+조 \(/, "").replace(/\)$/, "")}</span>
                  </a>
                ))}
              </div>
            </div>

            {/* Articles */}
            {articles.map((article) => (
              <div key={article.id} id={article.id} data-component="terms-section" style={{ marginBottom: "var(--space-10)", scrollMarginTop: "100px" }}>
                <h2 style={{ fontSize: "var(--text-xl)", fontWeight: "var(--font-semibold)" as string, color: "var(--color-neutral-800)", marginBottom: "var(--space-4)", paddingBottom: "var(--space-3)", borderBottom: "2px solid var(--color-primary-100)" }}>{article.title}</h2>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral-600)", lineHeight: "var(--leading-relaxed)" }}>{article.content}</div>
              </div>
            ))}

            {/* Meta */}
            <div data-component="terms-meta" style={{ borderTop: "1px solid var(--color-neutral-200)", paddingTop: "var(--space-6)", fontSize: "var(--text-sm)", color: "var(--color-neutral-400)" }}>
              <p><strong>시행일:</strong> 2024년 1월 1일</p>
              <p><strong>최종 수정일:</strong> 2025년 6월 1일</p>
              <p>문의: {COMPANY_INFO.email} | {COMPANY_INFO.phone}</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
