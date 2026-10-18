import { createHash } from "node:crypto";
import {
    EXPORT_TOKEN_PREFIX, generateExportToken, hashExportToken, parseExportBearer,
} from "domain/eformsign-backup/export";

const GOOD = `ebx_${"A".repeat(43)}`;

describe("generateExportToken", () => {
    it("is 'ebx_' + 43 base64url characters", () => {
        expect(EXPORT_TOKEN_PREFIX).toBe("ebx_");
        const token = generateExportToken();
        expect(token).toMatch(/^ebx_[A-Za-z0-9_-]{43}$/);
        expect(token).toHaveLength(47);
    });
    it("is random per call", () => {
        expect(generateExportToken()).not.toBe(generateExportToken());
    });
    it("decodes to exactly 32 bytes", () => {
        expect(Buffer.from(generateExportToken().slice(4), "base64url")).toHaveLength(32);
    });
});

describe("hashExportToken", () => {
    it("is lowercase 64-hex sha256 of the raw token, computed independently", () => {
        const token = "ebx_" + "x".repeat(43);
        const hash = hashExportToken(token);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        expect(hash).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
    });
    it("differs per token", () => {
        expect(hashExportToken(GOOD)).not.toBe(hashExportToken(`ebx_${"B".repeat(43)}`));
    });
});

describe("parseExportBearer", () => {
    it("returns the raw token for an exact 'Bearer ' header", () => {
        expect(parseExportBearer(`Bearer ${GOOD}`)).toBe(GOOD);
        const generated = generateExportToken();
        expect(parseExportBearer(`Bearer ${generated}`)).toBe(generated);
    });
    it.each([
        ["undefined", undefined],
        ["empty", ""],
        ["no scheme", GOOD],
        ["Basic scheme", `Basic ${GOOD}`],
        ["lowercase bearer", `bearer ${GOOD}`],
        ["uppercase BEARER", `BEARER ${GOOD}`],
        ["no space", `Bearer${GOOD}`],
        ["double space", `Bearer  ${GOOD}`],
        ["leading space", ` Bearer ${GOOD}`],
        ["trailing space", `Bearer ${GOOD} `],
        ["trailing newline", `Bearer ${GOOD}\n`],
        ["tab separator", `Bearer\t${GOOD}`],
        ["wrong prefix", `Bearer abc_${"A".repeat(43)}`],
        ["uppercase prefix", `Bearer EBX_${"A".repeat(43)}`],
        ["too short", `Bearer ebx_${"A".repeat(42)}`],
        ["too long", `Bearer ebx_${"A".repeat(44)}`],
        ["illegal character", `Bearer ebx_${"A".repeat(42)}!`],
        ["standard-base64 plus", `Bearer ebx_${"A".repeat(42)}+`],
        ["padding", `Bearer ebx_${"A".repeat(42)}=`],
        ["scheme only", "Bearer "],
    ])("rejects %s", (_label, header) => {
        expect(parseExportBearer(header as string | undefined)).toBeNull();
    });
});
