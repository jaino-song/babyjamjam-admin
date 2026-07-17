import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const areas = [
  { id: "Namdonggu", name: "Namdong-gu", koreanName: "남동구", bankName: "농협은행", accNum: "171777-52-129984" },
  { id: "Seogu", name: "Seo-gu", koreanName: "서구", bankName: "농협은행", accNum: "351-1268-7728-43" },
  { id: "Bupyunggu", name: "Bupyeong-gu", koreanName: "부평구", bankName: "농협은행", accNum: "171777-52-129984" },
  { id: "Yeonsugu", name: "Yeonsu-gu", koreanName: "연수구", bankName: "농협은행", accNum: "351-1268-7728-43" },
];

const voucherGroups = [
  { type: "A가1형", durations: [5, 10, 15], full: [732, 1464, 2196], grant: [659, 1165, 1525], actual: [73, 299, 671] },
  { type: "A통합1형", durations: [5, 10, 15], full: [732, 1464, 2196], grant: [569, 1002, 1303], actual: [163, 462, 893] },
  { type: "A라1형", durations: [5, 10, 15], full: [732, 1464, 2196], grant: [456, 764, 1035], actual: [276, 700, 1161] },
  { type: "A가2형", durations: [10, 15, 20], full: [1464, 2196, 2928], grant: [1345, 1794, 2094], actual: [119, 402, 834] },
  { type: "A통합2형", durations: [10, 15, 20], full: [1464, 2196, 2928], grant: [1165, 1525, 1767], actual: [299, 671, 1161] },
  { type: "A라2형", durations: [10, 15, 20], full: [1464, 2196, 2928], grant: [943, 1193, 1440], actual: [521, 1003, 1488] },
  { type: "A가3형", durations: [10, 15, 20], full: [1464, 2196, 2928], grant: [1374, 1838, 2154], actual: [90, 358, 774] },
  { type: "A통합3형", durations: [10, 15, 20], full: [1464, 2196, 2928], grant: [1195, 1548, 1797], actual: [269, 648, 1131] },
  { type: "A라3형", durations: [10, 15, 20], full: [1464, 2196, 2928], grant: [973, 1236, 1499], actual: [491, 960, 1429] },
  { type: "B가1형", durations: [10, 15, 20], full: [1832, 2748, 3664], grant: [1758, 2357, 2771], actual: [74, 391, 893] },
  { type: "B통합1형", durations: [10, 15, 20], full: [1832, 2748, 3664], grant: [1572, 2050, 2436], actual: [260, 698, 1228] },
  { type: "B라1형", durations: [10, 15, 20], full: [1832, 2748, 3664], grant: [1274, 1605, 1952], actual: [558, 1143, 1712] },
  { type: "B가2형", durations: [10, 15, 20], full: [2848, 4272, 5696], grant: [2614, 3478, 4289], actual: [234, 794, 1407] },
  { type: "B통합2형", durations: [10, 15, 20], full: [2848, 4272, 5696], grant: [2369, 3165, 3915], actual: [479, 1107, 1781] },
  { type: "B라2형", durations: [10, 15, 20], full: [2848, 4272, 5696], grant: [2004, 2698, 3353], actual: [844, 1574, 2343] },
  { type: "C가1형", durations: [15, 25, 40], full: [5544, 9240, 14784], grant: [5431, 8303, 12088], actual: [113, 937, 2696] },
  { type: "C통합1형", durations: [15, 25, 40], full: [5544, 9240, 14784], grant: [4983, 7368, 11039], actual: [561, 1872, 3745] },
  { type: "C라1형", durations: [15, 25, 40], full: [5544, 9240, 14784], grant: [4253, 6337, 9540], actual: [1291, 2903, 5244] },
  { type: "C가2형", durations: [15, 25, 40], full: [6408, 10680, 17088], grant: [6278, 9596, 13968], actual: [130, 1084, 3120] },
  { type: "C통합2형", durations: [15, 25, 40], full: [6408, 10680, 17088], grant: [5759, 8514, 12755], actual: [649, 2166, 4333] },
  { type: "C라2형", durations: [15, 25, 40], full: [6408, 10680, 17088], grant: [4914, 7321, 11020], actual: [1494, 3359, 6068] },
];

async function main() {
  for (const area of areas) {
    await prisma.area.upsert({
      where: { id: area.id },
      update: { name: area.name, korean_name: area.koreanName },
      create: { id: area.id, name: area.name, korean_name: area.koreanName },
    });
    await prisma.bank_account_info.upsert({
      where: { area_id: area.id },
      update: { bank_name: area.bankName, acc_num: area.accNum },
      create: { area_id: area.id, bank_name: area.bankName, acc_num: area.accNum },
    });
  }

  for (const group of voucherGroups) {
    for (let index = 0; index < group.durations.length; index += 1) {
      const duration = group.durations[index]!;
      const full = group.full[index]!;
      const grant = group.grant[index]!;
      const actual = group.actual[index]!;
      if (full !== grant + actual) {
        throw new Error(`Invalid totals for ${group.type} ${duration} days`);
      }
      const values = {
        year: 2026,
        type: group.type,
        duration: BigInt(duration),
        full_price: String(full * 1000),
        grant: String(grant * 1000),
        actual_price: String(actual * 1000),
      };
      const existing = await prisma.voucher_price_info.findFirst({
        where: { year: values.year, type: values.type, duration: values.duration },
      });
      if (existing) {
        await prisma.voucher_price_info.update({ where: { id: existing.id }, data: values });
      } else {
        await prisma.voucher_price_info.create({ data: values });
      }
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
