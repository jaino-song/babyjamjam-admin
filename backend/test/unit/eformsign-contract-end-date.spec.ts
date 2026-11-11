import { ConfigService } from '@nestjs/config';
import { CONTRACT_END_DATE_ENRICHMENT_BUDGET_MS, EformsignService } from '../../application/services/eformsign.service';
import { extractEformsignContractEndDate } from '../../application/utils/eformsign-contract-end-date';

const TOKEN = 'fixture-access-token';
const FAILURE = 'fixture-response-body-that-must-not-be-logged';
const endFields = { fields: [{ id: '계약 종료일', value: '2026-08-20' }] };
const doc = (id: string, status_type = '070', step_type = '06', step_name = '제공기관 확인') => ({
    id, current_status: { status_type, step_type, step_name }, created_date: Number(id) || 0,
});
const createService = () => {
    const service = new EformsignService({ getOrThrow: () => 'fixture-config' } as unknown as ConfigService);
    jest.spyOn(service, 'getInProgressDocuments').mockResolvedValue({ documents: [] });
    jest.spyOn(service, 'getCompletedDocuments').mockResolvedValue({ documents: [] });
    jest.spyOn(service, 'getRejectedDocuments').mockResolvedValue({ documents: [] });
    return service;
};

describe('extractEformsignContractEndDate', () => {
    it.each(['계약 종료일', '계약종료일', '서비스 종료일', '서비스종료일', 'endDate', 'contractEndDate'])(
        'reads explicit field %s', (id) => {
            expect(extractEformsignContractEndDate({ fields: [{ id, value: '2026-08-20' }] })?.toISOString().slice(0, 10))
                .toBe('2026-08-20');
        },
    );
    it('reads split Y/M/D written by legacy prefill', () => {
        expect(extractEformsignContractEndDate({ fields: [
            { id: '계약 종료 년도', value: '2026' },
            { id: '계약 종료 월', value: '8' },
            { id: '계약 종료 일', value: '20' },
        ] })?.toISOString().slice(0, 10)).toBe('2026-08-20');
    });
    it('reads the tail of 계약 기간', () => {
        expect(extractEformsignContractEndDate({ fields: [{ id: '계약 기간', value: '2026.08.01 ~ 2026.08.20' }] })
            ?.toISOString().slice(0, 10)).toBe('2026-08-20');
    });
    it('reads nested detail_template_info and keyed fields', () => {
        expect(extractEformsignContractEndDate({ detail_template_info: [{ nested: { contractEndDate: { field_value: '2026-08-20' } } }] })
            ?.toISOString().slice(0, 10)).toBe('2026-08-20');
        expect(extractEformsignContractEndDate({ detail_template_info: [{ fieldName: 'contractEndDate', inputValue: '2026-08-20' }] })
            ?.toISOString().slice(0, 10)).toBe('2026-08-20');
    });
    it('prefers explicit dates over parts and range, and parts over range', () => {
        const fields = [
            { id: '계약 종료 년도', value: '2026' }, { id: '계약 종료 월', value: '8' }, { id: '계약 종료 일', value: '21' },
            { id: '계약 기간', value: '2026.08.01 ~ 2026.08.22' },
        ];
        expect(extractEformsignContractEndDate({ fields })?.toISOString().slice(0, 10)).toBe('2026-08-21');
        expect(extractEformsignContractEndDate({ fields: [...endFields.fields, ...fields] })?.toISOString().slice(0, 10)).toBe('2026-08-20');
    });
    it.each([{}, { fields: [] }, { fields: [{ id: '계약 종료일', value: '2026-02-31' }] }])('returns null for absent/malformed fields', (input) => {
        expect(extractEformsignContractEndDate(input)).toBeNull();
    });
});

describe('EformsignService.getAllDocuments end-date enrichment', () => {
    afterEach(() => jest.restoreAllMocks());

    it('selects only in-progress provider steps after merging and deduplicating all inboxes', async () => {
        const service = createService();
        const selected = [doc('1'), doc('2', '060', '05', '담당자 검토'), doc('3', '071')];
        const unselected = [doc('4', '003'), doc('5', '080'), doc('6', '999'), doc('7', '070', '05', '이용자 서명')];
        jest.mocked(service.getInProgressDocuments).mockResolvedValue({ documents: [selected[0], ...unselected] });
        jest.mocked(service.getCompletedDocuments).mockResolvedValue({ documents: [selected[0], selected[1]] });
        jest.mocked(service.getRejectedDocuments).mockResolvedValue({ documents: [selected[2]] });
        const detail = jest.spyOn(service, 'getDocumentById').mockResolvedValue(endFields);
        const result = await service.getAllDocuments(TOKEN);
        expect(detail).toHaveBeenCalledTimes(3);
        for (const item of selected) {
            expect(detail).toHaveBeenCalledWith(TOKEN, item.id, expect.any(AbortSignal));
            expect(result.documents.find((row) => row.id === item.id)?.contract_end_date).toBe('2026-08-20');
        }
        for (const item of unselected) {
            expect(result.documents.find((row) => row.id === item.id)).not.toHaveProperty('contract_end_date');
        }
        expect(result.total_rows).toBe(7);
        expect(result.documents.map((row) => row.id)).toEqual(['7', '6', '5', '4', '3', '2', '1']);
    });

    it('resolves all 12 deferred detail calls with at most 5 in flight', async () => {
        const service = createService();
        jest.mocked(service.getInProgressDocuments).mockResolvedValue({ documents: Array.from({ length: 12 }, (_, i) => doc(String(i))) });
        const releases: Array<() => void> = [];
        let inFlight = 0;
        let peak = 0;
        const detail = jest.spyOn(service, 'getDocumentById').mockImplementation(() => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            return new Promise((resolve) => releases.push(() => {
                inFlight--;
                resolve(endFields);
            }));
        });
        const pending = service.getAllDocuments(TOKEN);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(detail).toHaveBeenCalledTimes(5);
        for (let settled = 0; settled < 12;) {
            expect(releases.length).toBeGreaterThan(0);
            const batch = releases.splice(0);
            for (const release of batch) release();
            settled += batch.length;
            await new Promise<void>((resolve) => setImmediate(resolve));
        }
        const result = await pending;
        expect(peak).toBeLessThanOrEqual(5);
        expect(inFlight).toBe(0);
        expect(detail).toHaveBeenCalledTimes(12);
        expect(result.documents).toHaveLength(12);
        expect(result.documents.every((row) => row.contract_end_date === '2026-08-20')).toBe(true);
    });

    it('sets null after detail failures and logs only the document id', async () => {
        const service = createService();
        jest.mocked(service.getInProgressDocuments).mockResolvedValue({ documents: [doc('1'), doc('2')] });
        jest.spyOn(service, 'getDocumentById').mockRejectedValueOnce(new Error(`${FAILURE} ${TOKEN}`)).mockResolvedValueOnce({ fields: [] });
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await service.getAllDocuments(TOKEN);
        expect(result.documents.every((row) => row.contract_end_date === null)).toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith('1');
        expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);
        expect(JSON.stringify(warn.mock.calls)).not.toContain(FAILURE);
    });
});

describe('EformsignService end-date enrichment deadline', () => {
    const BUDGET_MS = 8000;
    const originalFetch = global.fetch;

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it('returns 100 slow documents within the budget, preserving finished dates and aborting pending calls', async () => {
        expect(CONTRACT_END_DATE_ENRICHMENT_BUDGET_MS).toBe(BUDGET_MS);
        const service = createService();
        jest.mocked(service.getInProgressDocuments).mockResolvedValue({
            documents: Array.from({ length: 100 }, (_, i) => doc(String(i))),
        });
        const started: Array<{ at: number; signal?: AbortSignal; finished: boolean }> = [];
        let inFlight = 0;
        let peak = 0;
        global.fetch = jest.fn((_url, options) => new Promise<Response>((resolve, reject) => {
            const signal = options?.signal ?? undefined;
            const call = { at: Date.now(), signal, finished: false };
            started.push(call);
            inFlight++;
            peak = Math.max(peak, inFlight);
            const timer = setTimeout(() => {
                inFlight--;
                call.finished = true;
                signal?.removeEventListener('abort', abort);
                resolve({ ok: true, json: async () => endFields } as Response);
            }, 1600);
            const abort = () => {
                clearTimeout(timer);
                inFlight--;
                reject(new Error(`abort-message-must-not-be-logged ${TOKEN}`));
            };
            signal?.addEventListener('abort', abort, { once: true });
        }));
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const start = Date.now();
        let resolvedAt: number | undefined;
        const pending = service.getAllDocuments(TOKEN).then((result) => {
            resolvedAt = Date.now();
            return result;
        });

        await jest.advanceTimersByTimeAsync(BUDGET_MS);
        // Assert before awaiting, so an unbounded queue fails without hanging the test.
        expect(resolvedAt).toBeDefined();
        expect((resolvedAt ?? Infinity) - start).toBeLessThan(9000);
        const result = await pending;
        expect(result.documents).toHaveLength(100);
        expect(result.documents.filter((row) => row.contract_end_date === '2026-08-20')).toHaveLength(20);
        expect(result.documents.filter((row) => row.contract_end_date === null)).toHaveLength(80);
        expect(peak).toBeLessThanOrEqual(5);
        expect(inFlight).toBe(0);
        expect(started).toHaveLength(25);
        expect(started.every((call) => call.at - start < BUDGET_MS)).toBe(true);
        expect(started.every((call) => call.signal instanceof AbortSignal)).toBe(true);
        expect(started.every((call) => call.finished || call.signal?.aborted)).toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);
        expect(JSON.stringify(warn.mock.calls)).not.toContain('abort-message-must-not-be-logged');
        expect(jest.getTimerCount()).toBe(0);
        await jest.advanceTimersByTimeAsync(30000);
        expect(started).toHaveLength(25);
    });

    it('returns at the deadline even if a detail implementation ignores abort, and ignores late results', async () => {
        const service = createService();
        jest.mocked(service.getInProgressDocuments).mockResolvedValue({ documents: [doc('1')] });
        let release: (value: typeof endFields) => void = () => {};
        const detail = jest.spyOn(service, 'getDocumentById').mockImplementation(() => new Promise((resolve) => {
            release = resolve;
        }));
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        let result: Awaited<ReturnType<typeof service.getAllDocuments>> | undefined;
        const pending = service.getAllDocuments(TOKEN).then((value) => { result = value; });
        await jest.advanceTimersByTimeAsync(BUDGET_MS);
        expect(result?.documents[0].contract_end_date).toBeNull();
        await pending;
        expect(detail.mock.calls[0]?.[2]?.aborted).toBe(true);
        release(endFields);
        await jest.advanceTimersByTimeAsync(1);
        expect(result?.documents[0].contract_end_date).toBeNull();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('clears the deadline timer when all details finish early', async () => {
        const service = createService();
        jest.mocked(service.getInProgressDocuments).mockResolvedValue({ documents: [doc('1')] });
        const detail = jest.spyOn(service, 'getDocumentById').mockResolvedValue(endFields);
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await service.getAllDocuments(TOKEN);
        expect(result.documents[0].contract_end_date).toBe('2026-08-20');
        expect(jest.getTimerCount()).toBe(0);
        await jest.advanceTimersByTimeAsync(BUDGET_MS);
        expect(detail.mock.calls[0]?.[2]?.aborted).toBe(false);
        expect(warn).not.toHaveBeenCalled();
    });
});
