import { ConfigService } from '@nestjs/config';
import { EformsignService } from '../../application/services/eformsign.service';
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
            expect(detail).toHaveBeenCalledWith(TOKEN, item.id);
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
