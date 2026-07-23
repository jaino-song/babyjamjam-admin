export const INCHEON_STAFF_BRANCH_SLUG = "incheon";

const INCHEON_PUBLIC_BRANCH_SLUG_PREFIX = `${INCHEON_STAFF_BRANCH_SLUG}-`;

export const INCHEON_PUBLIC_DISTRICT_BRANCH_SLUGS = [
    "incheon-junggu",
    "incheon-donggu",
    "incheon-michuhol",
    "incheon-yeonsu",
    "incheon-namdong",
    "incheon-bupyeong",
    "incheon-gyeyang",
    "incheon-seogu",
] as const;

export function getStaffBranchSlugForPublicInquiry(publicBranchSlug: string): string {
    const branchSlug = publicBranchSlug.trim();

    if (branchSlug.startsWith(INCHEON_PUBLIC_BRANCH_SLUG_PREFIX)) {
        return INCHEON_STAFF_BRANCH_SLUG;
    }

    return branchSlug;
}

// All registered branches are now real, staff-operational branches. Staff
// visibility is governed solely by the branch's `isActive` flag (checked by the
// callers), so no slug-based hiding is applied here. The Incheon district slugs
// and `getStaffBranchSlugForPublicInquiry` above are retained because they still
// drive public-inquiry routing (district inquiries centralize on the HQ branch).
export function isVisibleStaffBranchSlug(_branchSlug: string): boolean {
    return true;
}
