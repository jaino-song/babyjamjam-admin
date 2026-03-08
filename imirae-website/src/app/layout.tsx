import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "인천 아이미래로 | 산후관리 전문",
    template: "%s | 인천 아이미래로",
  },
  description:
    "인천 남동구 산후관리 전문 기관. 2,500건 이상의 경험으로 산모와 신생아에게 따뜻하고 전문적인 케어를 제공합니다. 정부지원 바우처 사용 가능.",
  keywords: [
    "산후관리",
    "인천 산후관리",
    "남동구 산후관리",
    "산후도우미",
    "신생아 케어",
    "정부지원 바우처",
    "아이미래로",
  ],
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "인천 아이미래로",
    title: "인천 아이미래로 | 산후관리 전문",
    description:
      "인천 남동구 산후관리 전문 기관. 2,500건 이상의 경험으로 산모와 신생아에게 따뜻하고 전문적인 케어를 제공합니다.",
  },
  robots: {
    index: true,
    follow: true,
  },
  other: {
    "naver-site-verification": "placeholder",
  },
};

const jsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  name: "인천 아이미래로",
  description:
    "인천 남동구 산후관리 전문 기관. 산모와 신생아에게 따뜻하고 전문적인 케어를 제공합니다.",
  telephone: "(032) 442-5992",
  email: "forchildrenbysongs@gmail.com",
  address: {
    "@type": "PostalAddress",
    streetAddress: "구월남로 120 백세빌딩 302호",
    addressLocality: "남동구",
    addressRegion: "인천광역시",
    addressCountry: "KR",
  },
  url: "https://imirae-incheon.com",
  sameAs: [
    "https://www.instagram.com/imirae_incheon/",
    "https://blog.naver.com/imirae-incheon",
  ],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <script type="application/ld+json">{jsonLd}</script>
      </head>
      <body data-component="root">{children}</body>
    </html>
  );
}
