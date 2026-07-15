# Requirements: imirae-incheon.com Website Redesign

**Date:** 2026-03-07
**Status:** Approved
**Branch:** feat-web-completion

---

## 1. Goal

Rebuild the company website (imirae-incheon.com) with a modern, responsive design. Replace the existing Wix-based site with a custom Next.js application deployed as a standalone project.

## 2. Non-Goals (Out of Scope)

- User login / authentication (no member system)
- Online payment or booking system
- Blog / CMS / admin panel for content editing
- Multi-language support (Korean only)
- Integration with the back-office app
- Mobile app (web responsive only)
- E-commerce functionality

## 3. Pages (7 total)

| # | Route | Page | Description |
|---|-------|------|-------------|
| 1 | `/` | 홈 (Home) | Hero section, quick action cards (정부지원 조회/신청, 서비스, 비용), service reviews, professional training section, awards/certifications, consultation CTA |
| 2 | `/introduction` | 소개 (Introduction) | Company philosophy, CEO quote, 2500+ services stats, certifications, training info, testimonials |
| 3 | `/program` | 산후관리서비스 (Program) | Postpartum care service details |
| 4 | `/plan` | 비용 (Plan) | Pricing information/tiers |
| 5 | `/reviews` | 후기 (Reviews) | Customer testimonials |
| 6 | `/disclaimer` | 이용약관 (Disclaimer) | Terms of use |
| 7 | `/contact` | 문의하기 (Contact) | Contact form with email notification |

## 4. Design Direction

- **Style:** Warm & Trustworthy
- **Colors:** Soft pastels, cream, gentle pinks/greens
- **Elements:** Rounded corners, organic shapes
- **Feel:** Care, safety, comfort -- healthcare/childcare brand
- **Responsive:** Mobile, tablet, desktop

## 5. Content Strategy

- Migrate all existing text and images from the current Wix site as-is
- No new content to produce -- redesign only
- Existing content source: https://www.imirae-incheon.com/

## 6. Key Interactions

### 6.1 상담 신청 (Consultation Request) CTA
- Opens a **popup/modal form** (no page navigation)
- Present on Home page and Introduction page
- Form submits via email notification

### 6.2 문의하기 (Contact) Form
- Full-page contact form
- Sends **email notification** to company email on submission
- No backend integration required

### 6.3 External Links
- 정부지원 자격 조회 -> https://www.bokjiro.go.kr/ssis-tbu/twatbz/mkclAsis/mkclInsertPwnbPage.do
- 정부지원 신청하기 -> https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoReldBizId=WII00000460
- 후기 더 보기 -> https://blog.naver.com/imirae-incheon
- Instagram -> https://www.instagram.com/imirae_incheon/
- Naver Blog -> https://blog.naver.com/imirae-incheon
- Email -> forchildrenbysongs@gmail.com

## 7. Tech Stack

| Component | Choice |
|-----------|--------|
| Framework | Next.js (App Router) |
| Language | TypeScript |
| Package Manager | pnpm |
| Styling | Tailwind CSS |
| Hosting | Vercel |
| Repository | New standalone repo (separate from back-office) |

## 8. SEO & Analytics

- **Meta tags** on all pages (title, description, keywords)
- **Open Graph** tags for social sharing
- **Structured data** (JSON-LD) for local business schema
- **sitemap.xml** auto-generated
- **robots.txt** configured
- **Naver Search Advisor** integration
- **Google Analytics** and/or **Naver Analytics**
- Semantic HTML for accessibility and crawlability

## 9. Company Information (for footer & structured data)

- Company Name: 인천 아이미래로
- Phone: (032) 442-5992
- Fax: (0303) 3444-5992
- Email: forchildrenbysongs@gmail.com
- Website: imirae-incheon.com
- Address: 인천광역시 남동구 구월남로 120 백세빌딩 302호
- Instagram: https://www.instagram.com/imirae_incheon/
- Naver Blog: https://blog.naver.com/imirae-incheon

## 10. Acceptance Criteria

1. All 7 pages render correctly on mobile, tablet, and desktop
2. Lighthouse performance score >= 90
3. All existing content from current site is present
4. Contact form sends email successfully
5. 상담 신청 modal opens and submits correctly
6. SEO metadata is present on all pages
7. Sitemap and robots.txt are generated
8. External links (bokjiro, Naver blog, Instagram) work correctly
9. Design matches the "Warm & Trustworthy" direction approved in Phase 2 mockups
