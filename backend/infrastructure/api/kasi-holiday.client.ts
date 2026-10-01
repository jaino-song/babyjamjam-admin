import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const KASI_REST_DE_INFO_URL =
    "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";
const KASI_REQUEST_TIMEOUT_MS = 10_000;
const KASI_MONTH_CONCURRENCY = 3;

/**
 * Why a KASI year fetch failed. Deliberately a closed set of short codes: the
 * reason (and the error message built from it) must never carry the response
 * body, the request URL or the service key.
 */
export type KasiHolidayErrorReason =
    | "not_configured"
    | "timeout"
    | "network"
    | "http_error"
    | "upstream_invalid"
    | "result_code"
    | "count_mismatch";

export class KasiHolidayError extends Error {
    constructor(
        readonly reason: KasiHolidayErrorReason,
        readonly month?: number,
        readonly httpStatus?: number,
    ) {
        const where = month === undefined ? "" : ` for month ${String(month).padStart(2, "0")}`;
        const status = httpStatus === undefined ? "" : ` (HTTP ${httpStatus})`;
        super(`KASI holiday fetch failed${where}: ${reason}${status}`);
        this.name = "KasiHolidayError";
    }
}

export interface KasiHolidayItem {
    /** `YYYY-MM-DD` */
    date: string;
    name: string;
}

export interface KasiHolidayYear {
    year: number;
    /** `isHoliday === "Y"` items only, one per KASI item (two names may share a date). */
    items: KasiHolidayItem[];
    /** Sum of KASI `totalCount` over the 12 months (includes non-holiday items). 0 = nothing published. */
    rawCount: number;
}

interface KasiMonthResult {
    totalCount: number;
    items: KasiHolidayItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** KASI special-day (`SpcdeInfoService/getRestDeInfo`) client. */
@Injectable()
export class KasiHolidayClient {
    private readonly logger = new Logger(KasiHolidayClient.name);

    constructor(private readonly configService: ConfigService) {}

    isConfigured(): boolean {
        return Boolean(this.configService.get<string>("DATA_GO_KR_SERVICE_KEY"));
    }

    async fetchYear(year: number): Promise<KasiHolidayYear> {
        const serviceKey = this.configService.get<string>("DATA_GO_KR_SERVICE_KEY");
        if (!serviceKey) {
            this.logger.warn("DATA_GO_KR_SERVICE_KEY is not configured; holiday sync is disabled.");
            throw new KasiHolidayError("not_configured");
        }

        const months = Array.from({ length: 12 }, (_, i) => i + 1);
        const results = new Map<number, KasiMonthResult>();
        for (let i = 0; i < months.length; i += KASI_MONTH_CONCURRENCY) {
            const batch = months.slice(i, i + KASI_MONTH_CONCURRENCY);
            const settled = await Promise.all(
                batch.map(async (month) => [month, await this.fetchMonth(serviceKey, year, month)] as const),
            );
            for (const [month, result] of settled) results.set(month, result);
        }

        const items: KasiHolidayItem[] = [];
        let rawCount = 0;
        for (const month of months) {
            const result = results.get(month)!;
            rawCount += result.totalCount;
            items.push(...result.items);
        }
        return { year, items, rawCount };
    }

    private async fetchMonth(serviceKey: string, year: number, month: number): Promise<KasiMonthResult> {
        const params = new URLSearchParams({
            serviceKey,
            solYear: String(year),
            solMonth: String(month).padStart(2, "0"),
            numOfRows: "100",
            pageNo: "1",
            _type: "json",
        });

        let response: Response;
        try {
            response = await fetch(`${KASI_REST_DE_INFO_URL}?${params.toString()}`, {
                signal: AbortSignal.timeout(KASI_REQUEST_TIMEOUT_MS),
            });
        } catch (error) {
            const name = error instanceof Error ? error.name : "";
            throw new KasiHolidayError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network", month);
        }

        if (response.status !== 200) {
            throw new KasiHolidayError("http_error", month, response.status);
        }

        // data.go.kr gateway errors come back as XML with HTTP 200 even with `_type=json`,
        // so a non-JSON body is an upstream failure. The body text is never surfaced.
        let payload: unknown;
        try {
            payload = JSON.parse(await response.text());
        } catch {
            throw new KasiHolidayError("upstream_invalid", month);
        }
        return this.parseMonth(payload, year, month);
    }

    private parseMonth(payload: unknown, year: number, month: number): KasiMonthResult {
        const root = isRecord(payload) ? payload["response"] : undefined;
        const header = isRecord(root) ? root["header"] : undefined;
        const body = isRecord(root) ? root["body"] : undefined;
        if (!isRecord(header) || !isRecord(body)) {
            throw new KasiHolidayError("upstream_invalid", month);
        }
        if (String(header["resultCode"]) !== "00") {
            throw new KasiHolidayError("result_code", month);
        }

        const totalCount = Number(body["totalCount"]);
        if (!Number.isInteger(totalCount) || totalCount < 0) {
            throw new KasiHolidayError("upstream_invalid", month);
        }

        // `items` is "" when empty, `{ item: X }` otherwise with X an object (single) or an array.
        const rawItems = body["items"];
        let list: unknown[] = [];
        if (isRecord(rawItems)) {
            const item = rawItems["item"];
            list = Array.isArray(item) ? item : item === undefined ? [] : [item];
        } else if (rawItems !== "" && rawItems !== undefined && rawItems !== null) {
            throw new KasiHolidayError("upstream_invalid", month);
        }

        if (list.length !== totalCount) {
            throw new KasiHolidayError("count_mismatch", month);
        }

        const items: KasiHolidayItem[] = [];
        for (const entry of list) {
            if (!isRecord(entry)) throw new KasiHolidayError("upstream_invalid", month);
            const locdate = String(Number(entry["locdate"]));
            const name = entry["dateName"];
            if (!/^\d{8}$/.test(locdate) || typeof name !== "string" || name.trim() === "") {
                throw new KasiHolidayError("upstream_invalid", month);
            }
            const date = `${locdate.slice(0, 4)}-${locdate.slice(4, 6)}-${locdate.slice(6, 8)}`;
            if (!this.isValidDateInMonth(date, year, month)) {
                throw new KasiHolidayError("upstream_invalid", month);
            }
            if (entry["isHoliday"] === "Y") items.push({ date, name: name.trim() });
        }
        return { totalCount, items };
    }

    private isValidDateInMonth(iso: string, year: number, month: number): boolean {
        const parsed = new Date(`${iso}T00:00:00.000Z`);
        return !Number.isNaN(parsed.getTime())
            && parsed.toISOString().slice(0, 10) === iso
            && parsed.getUTCFullYear() === year
            && parsed.getUTCMonth() + 1 === month;
    }
}
