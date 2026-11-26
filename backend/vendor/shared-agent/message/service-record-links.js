"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_RECORD_LINK_DEFAULT_TEMPLATE = void 0;
exports.renderServiceRecordLinks = renderServiceRecordLinks;
const utils_1 = require("../template/utils");
const LEGACY_LINK_BLOCK = "제공기록지 링크\n{{serviceRecordUrl}}";
const DEFAULT_INTRO_END = "시작 서비스 제공기록지 작성 링크입니다.";
const MAX_CARRIER_BYTES = 2000;
exports.SERVICE_RECORD_LINK_DEFAULT_TEMPLATE = `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

{{employeeName}} 관리사님, {{clientName}} 산모님의 {{serviceStartDate}} ${DEFAULT_INTRO_END}
매일 서비스 제공 완료 직전에 서비스 세부사항 기록 후에, 산모님께 승인을 받으시면 됩니다.

최초 접속 시에 관리사님의 전화번호 인증이 필요합니다. 링크 접속 후 휴대폰 번호로 본인확인하고, 방문일마다 기록을 남겨주세요.

감사합니다.

${LEGACY_LINK_BLOCK}`;
function getUrlKey(url) {
    if (typeof url !== "string" || !/^https?:\/\/[^/?#]/i.test(url))
        return null;
    if (/[\s\p{Cc}\p{Cf}\\<>"`{}]|%(?![\da-f]{2})/iu.test(url))
        return null;
    try {
        const parsed = new URL(url);
        return parsed.username || parsed.password ? null : parsed.href;
    }
    catch {
        return null;
    }
}
function validMembers(count, members) {
    if (count !== null && (!Number.isSafeInteger(count) || count < 1))
        return false;
    if (!Array.isArray(members) || members.length === 0 || members.length > (count ?? 1))
        return false;
    const ranks = new Set();
    const urls = new Set();
    for (const member of members) {
        if (!member)
            return false;
        const { activeRank, url } = member;
        if (activeRank === null) {
            if (count !== null && count !== 1)
                return false;
        }
        else {
            if (!Number.isSafeInteger(activeRank) || activeRank < 1 ||
                (count !== null && activeRank > count) || ranks.has(activeRank))
                return false;
            ranks.add(activeRank);
        }
        const urlKey = getUrlKey(url);
        if (urlKey === null || urls.has(urlKey))
            return false;
        urls.add(urlKey);
    }
    return true;
}
const KOREAN_ORDINALS = ["첫째", "둘째", "셋째", "넷째", "다섯째", "여섯째", "일곱째", "여덟째", "아홉째", "열째"];
function renderRankedLinks(members) {
    const ordered = [...members].sort((left, right) => (left.activeRank ?? 1) - (right.activeRank ?? 1));
    const ordinals = ordered.map(({ activeRank }) => KOREAN_ORDINALS[(activeRank ?? 1) - 1] ?? `${activeRank}번째`);
    const subjects = ordinals.join(ordinals.length === 2 ? "와 " : ", ");
    const action = ordinals.length > 1 ? "각각 작성해 주세요." : "작성해 주세요.";
    return {
        instruction: `${subjects}의 기록지를 ${action}`,
        blocks: ordered.map(({ url }, index) => `${ordinals[index]} 아기 제공기록지\n${url}`).join("\n\n"),
    };
}
function renderLinkTemplate(template, variables, links) {
    // Match the same variable syntax as renderTemplate, including whitespace inside braces.
    const matches = [...template.matchAll(/\{\{([^}]+)\}\}/g)].filter(([, rawKey]) => {
        const key = rawKey.trim();
        return key === "serviceRecordLinks" || key === "serviceRecordUrl";
    });
    const insertion = matches.find(([, rawKey]) => rawKey.trim() === "serviceRecordLinks") ?? matches[0];
    if (!insertion)
        return null;
    let content = "";
    let offset = 0;
    for (const match of matches) {
        const index = match.index;
        content += (0, utils_1.renderTemplate)(template.slice(offset, index), variables);
        if (match === insertion)
            content += links;
        offset = index + match[0].length;
    }
    return content + (0, utils_1.renderTemplate)(template.slice(offset), variables);
}
let carrierCharacters;
function getCarrierCharacters() {
    if (carrierCharacters)
        return carrierCharacters;
    // A2E6 is the Euro sign in KS X 1001, but some EUC-KR decoders omit it.
    const characters = new Set(["€"]);
    const decoder = new TextDecoder("euc-kr");
    const pair = new Uint8Array(2);
    // Limit the decoder to the KS X 1001 rows, excluding CP949 extensions and user-defined rows.
    for (let lead = 0xa1; lead <= 0xfd; lead++) {
        if ((lead > 0xac && lead < 0xb0) || lead === 0xc9)
            continue;
        pair[0] = lead;
        for (let trail = 0xa1; trail <= 0xfe; trail++) {
            pair[1] = trail;
            const character = decoder.decode(pair);
            if (character.length === 1 && character !== "\ufffd")
                characters.add(character);
        }
    }
    carrierCharacters = characters;
    return characters;
}
function fitsCarrier(content) {
    let bytes = 0;
    for (const character of content) {
        const codePoint = character.charCodeAt(0);
        // Outside the two-byte carrier repertoire, budget the actual UTF-8 size per code point.
        if (codePoint <= 0x7f)
            bytes += 1;
        else if (character.length === 2)
            bytes += 4;
        else if (codePoint <= 0x7ff || getCarrierCharacters().has(character))
            bytes += 2;
        else
            bytes += 3;
        if (bytes > MAX_CARRIER_BYTES)
            return false;
    }
    return bytes > 0;
}
function renderServiceRecordLinks(input) {
    const { template, variables, householdBabyCount, members } = input;
    if (typeof template !== "string" || !variables || typeof variables !== "object") {
        return { ok: false, reason: "invalid_template" };
    }
    if (!validMembers(householdBabyCount, members))
        return { ok: false, reason: "invalid_members" };
    const first = members[0];
    const isUnambiguousSingleton = householdBabyCount === 1 ||
        (householdBabyCount === null && first.activeRank === null);
    let effectiveTemplate = template;
    let links = first.url;
    if (!isUnambiguousSingleton) {
        const { instruction, blocks } = renderRankedLinks(members);
        if (template === exports.SERVICE_RECORD_LINK_DEFAULT_TEMPLATE) {
            effectiveTemplate = template
                .replace(DEFAULT_INTRO_END, `${DEFAULT_INTRO_END}\n${instruction}`)
                .replace(LEGACY_LINK_BLOCK, "{{serviceRecordLinks}}");
            links = blocks;
        }
        else {
            links = `${instruction}\n\n${blocks}`;
        }
    }
    const content = renderLinkTemplate(effectiveTemplate, variables, links);
    if (content === null)
        return { ok: false, reason: "missing_link_placeholder" };
    if (!fitsCarrier(content))
        return { ok: false, reason: "message_too_large" };
    return { ok: true, content, buttonUrl: isUnambiguousSingleton ? first.url : null };
}
