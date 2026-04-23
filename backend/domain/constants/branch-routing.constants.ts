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

export function isVisibleStaffBranchSlug(branchSlug: string): boolean {
    return branchSlug === INCHEON_STAFF_BRANCH_SLUG
        || !branchSlug.startsWith(INCHEON_PUBLIC_BRANCH_SLUG_PREFIX);
}
