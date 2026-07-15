/**
 * Shared Model Interfaces for imirae-incheon.com
 *
 * Domain models and constants shared across the application.
 * For API request/response shapes, see ./api.ts
 */

// ---------------------------------------------------------------------------
// Company Information
// ---------------------------------------------------------------------------

export interface CompanyInfo {
  name: string;
  phone: string;
  fax: string;
  email: string;
  website: string;
  address: string;
  instagram: string;
  naverBlog: string;
}

export const COMPANY_INFO: CompanyInfo = {
  name: "인천 아이미래로",
  phone: "(032) 442-5992",
  fax: "(0303) 3444-5992",
  email: "forchildrenbysongs@gmail.com",
  website: "imirae-incheon.com",
  address: "인천광역시 남동구 구월남로 120 백세빌딩 302호",
  instagram: "https://www.instagram.com/imirae_incheon/",
  naverBlog: "https://blog.naver.com/imirae-incheon",
};

// ---------------------------------------------------------------------------
// External Links
// ---------------------------------------------------------------------------

export const EXTERNAL_LINKS = {
  govSupportCheck:
    "https://www.bokjiro.go.kr/ssis-tbu/twatbz/mkclAsis/mkclInsertPwnbPage.do",
  govSupportApply:
    "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoReldBizId=WII00000460",
  naverBlog: "https://blog.naver.com/imirae-incheon",
  instagram: "https://www.instagram.com/imirae_incheon/",
} as const;

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export interface NavItem {
  label: string;
  href: string;
  external?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "홈", href: "/" },
  { label: "소개", href: "/introduction" },
  { label: "산후관리서비스", href: "/program" },
  { label: "비용", href: "/plan" },
  { label: "후기", href: "/reviews" },
  { label: "문의하기", href: "/contact" },
];

// ---------------------------------------------------------------------------
// Form Field Constraints (mirrors Zod schemas for client-side reference)
// ---------------------------------------------------------------------------

export const FORM_CONSTRAINTS = {
  name: { min: 1, max: 50 },
  email: { max: 254 },
  phone: { min: 9, max: 20, pattern: /^[0-9+\-\s]{9,20}$/ },
  subject: { min: 1, max: 100 },
  contactMessage: { min: 1, max: 2000 },
  consultationMessage: { max: 500 },
} as const;
