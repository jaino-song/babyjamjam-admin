import { PrismaClient } from "@prisma/client";

import { INCHEON_STAFF_BRANCH_SLUG } from "../../domain/constants/branch-routing.constants";

const prisma = new PrismaClient();

const PUBLIC_BRANCHES = [
    {
        slug: INCHEON_STAFF_BRANCH_SLUG,
        name: "인천지점",
        region: "인천",
        district: "인천",
        branchType: "direct",
        address: "",
        phone: "1661-2386",
        businessHours: "평일 09:00 – 18:00",
        description: "인천 전 지역 상담 접수 지점.",
    },
    {
        slug: "gyeongsan",
        name: "경북 경산점",
        region: "경북",
        district: "경산시",
        branchType: "franchise",
        address: "경상북도 경산시 중방로 31, 4층",
        phone: "053-851-9807",
        businessHours: "평일 09:00 – 18:00",
        description: "경산·영천·청도 지역 담당. 경산시청 인근 접근성 좋은 지점.",
    },
    {
        slug: "goyang-paju",
        name: "고양파주점",
        region: "경기도",
        district: "고양파주",
        branchType: "direct",
        address: "경기도 고양시 덕양구 중앙로 1205, 3층",
        phone: "1661-2386",
        businessHours: "평일 09:00 – 18:00",
        description: "고양·파주 지역 전담. 덕양구·일산·파주 접근성 좋은 지점.",
    },
    {
        slug: "bucheon",
        name: "부천점",
        region: "경기도",
        district: "부천시",
        branchType: "direct",
        address: "경기도 부천시 중동로 248, 4층",
        phone: "1661-2386",
        businessHours: "평일 09:00 – 18:00",
        description: "부천 원미·소사·오정 지역 전담. 중동역 인근.",
    },
    {
        slug: "gimpo",
        name: "김포점",
        region: "경기도",
        district: "김포시",
        branchType: "direct",
        address: "경기도 김포시 김포한강9로 76, 3층",
        phone: "1661-2386",
        businessHours: "평일 09:00 – 18:00",
        description: "김포 한강신도시·사우 지역 전담.",
    },
] as const;

async function main(): Promise<void> {
    const ownerEmail = process.env["BRANCH_SEED_OWNER_EMAIL"]?.trim().toLowerCase();

    if (!ownerEmail) {
        throw new Error("BRANCH_SEED_OWNER_EMAIL is required.");
    }

    const owner = await prisma.user.findUnique({
        where: { email: ownerEmail },
        select: { id: true, email: true },
    });

    if (!owner) {
        throw new Error(`No owner user found for BRANCH_SEED_OWNER_EMAIL=${ownerEmail}.`);
    }

    for (const branch of PUBLIC_BRANCHES) {
        await prisma.branch.upsert({
            where: { slug: branch.slug },
            update: {
                name: branch.name,
                region: branch.region,
                district: branch.district,
                branchType: branch.branchType,
                address: branch.address,
                phone: branch.phone,
                businessHours: branch.businessHours,
                description: branch.description,
                isActive: true,
            },
            create: {
                ...branch,
                email: null,
                isActive: true,
                ownerId: owner.id,
            },
        });
    }

    const deactivatedIncheonDistrictBranches = await prisma.branch.updateMany({
        where: {
            slug: { not: INCHEON_STAFF_BRANCH_SLUG },
            OR: [
                { region: "인천" },
                { slug: { startsWith: `${INCHEON_STAFF_BRANCH_SLUG}-` } },
            ],
        },
        data: {
            isActive: false,
        },
    });

    console.log(
        `Seeded ${PUBLIC_BRANCHES.length} public branches for ${owner.email}; ` +
        `deactivated ${deactivatedIncheonDistrictBranches.count} Incheon district branches.`,
    );
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
