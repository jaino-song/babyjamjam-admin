import { normalizeBirthdayIsoDate } from "@babyjamjam/shared/utils/birthday";

interface ClientIdentity {
    name?: string | null;
    birthday?: string | null;
}

/** 이름과 생년월일이 모두 확인된 경우에만 자동 연결을 허용한다. */
export function compareEformsignClientIdentity(
    contract: ClientIdentity | null,
    client: ClientIdentity,
    now: Date = new Date(),
): Array<"name" | "birthday"> {
    const differences: Array<"name" | "birthday"> = [];
    const contractName = contract?.name?.normalize("NFC").trim().replace(/\s+/g, "");
    const clientName = client.name?.normalize("NFC").trim().replace(/\s+/g, "");
    if (!contractName || !clientName || contractName !== clientName) differences.push("name");

    const contractBirthday = normalizeBirthdayIsoDate(contract?.birthday, now);
    const clientBirthday = normalizeBirthdayIsoDate(client.birthday, now);
    if (!contractBirthday || !clientBirthday || contractBirthday !== clientBirthday) differences.push("birthday");
    return differences;
}
