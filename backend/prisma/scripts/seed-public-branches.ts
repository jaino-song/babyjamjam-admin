import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PUBLIC_BRANCHES = [
    {
        slug: "incheon-junggu",
        name: "인천 중구점",
        region: "인천",
        district: "중구",
        branchType: "direct",
        address: "인천광역시 중구 신포로 27, 4층",
        phone: "1661-2386",
        businessHours: "평일 09:00 – 18:00",
        description: "인천 중구·영종 지역 전담. 신포역 인근.",
    },
    {
        slug: "incheon-donggu",
        name: "인천 동구점",
        region: "인천",
        district: "동구",
        branchType: "direct",
        address: "인천광역시 동구 솔빛로 105, 3층",
        phone: "1661-2386",
        businessHours: "평일 09:00 – 18:00",
        description: "인천 동구 전담. 동인천역 도보 3분.",
    },
    {
        slug: "incheon-michuhol",
        name: "인천 미추홀구점",
        region: "인천",
        district: "미추홀구",
        branchType: "direct",
        address: "인천광역시 미추홀구 경인로 229, 5층",
        phone: "1661-2386",
        businessHours: "평일 09:00 – 18:00",
        description: "미추홀구 전담. 주안역 인근.",
    },
    {
        slug: "incheon-yeonsu",
        name: "인천 연수구점",
        region: "인천",
        district: "연수구",
        branchType: "direct",
        address: "인천광역시 연수구 컨벤시아대로 165, 6층",
        phone: "1661-2386",
        businessHours: "평일 09:00 – 18:00",
        description: "연수·송도 지역 전담. 센트럴파크역 인근.",
    },
    {
        slug: "incheon-namdong",
        name: "인천 남동구점",
        region: "인천",
        district: "남동구",
        branchType: "direct",
        address: "인천광역시 남동구 인주대로 552, 3층",
        phone: "1661-2386",
        businessHours: "평일 09:00 – 18:00",
        description: "남동구 전담. 남동인더스파크역 인근.",
    },
    {
        slug: "incheon-bupyeong",
        name: "인천 부평구점",
        region: "인천",
        district: "부평구",
        branchType: "direct",
        address: "인천광역시 부평구 부평대로 283, 4층",
        phone: "1661-2386",
        businessHours: "평일 09:00 – 18:00",
        description: "부평구 전담. 부평역 도보 5분.",
    },
    {
        slug: "incheon-gyeyang",
        name: "인천 계양구점",
        region: "인천",
        district: "계양구",
        branchType: "direct",
        address: "인천광역시 계양구 계양대로 145, 3층",
        phone: "1661-2386",
        businessHours: "평일 09:00 – 18:00",
        description: "계양구 전담. 계양역 인근.",
    },
    {
        slug: "incheon-seogu",
        name: "인천 서구점",
        region: "인천",
        district: "서구",
        branchType: "direct",
        address: "인천광역시 서구 청라대로 229, 5층",
        phone: "1661-2386",
        businessHours: "평일 09:00 – 18:00",
        description: "서구·청라 지역 전담. 검암역 인근.",
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

    console.log(`Seeded ${PUBLIC_BRANCHES.length} public branches for ${owner.email}.`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
