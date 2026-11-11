import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'infrastructure/database/prisma.service';
import { EformsignService } from '../../application/services/eformsign.service';

const TOKEN = 'fixture-access-token';
const doc = (id: string, status_type = '070', created_date = 1) => ({
    id, current_status: { status_type, step_type: '06', step_name: '제공기관 확인' }, created_date,
});
const createService = () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new EformsignService(
        { getOrThrow: () => 'fixture-config' } as unknown as ConfigService,
        { eformsign_doc: { findMany } } as unknown as PrismaService,
    );
    const inProgress = jest.spyOn(service, 'getInProgressDocuments').mockResolvedValue({ documents: [] });
    const completed = jest.spyOn(service, 'getCompletedDocuments').mockResolvedValue({ documents: [] });
    const rejected = jest.spyOn(service, 'getRejectedDocuments').mockResolvedValue({ documents: [] });
    const detail = jest.spyOn(service, 'getDocumentById').mockResolvedValue({ fields: [] });
    return { service, findMany, inProgress, completed, rejected, detail };
};

describe('EformsignService.getAllDocuments mirror deleted filter', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each(['049', '047', '099', 'doc_delete', 'doc_request_delete', 'doc_tombstone', '49', ' DOC_DELETE '])(
        'hides mirror status %s across deduplicated inboxes before fetching details', async (status_type) => {
            const { service, findMany, inProgress, completed, rejected, detail } = createService();
            const hidden = doc('hidden');
            const revokedMirror = doc('revoked-mirror', '060', 2);
            const activeMirror = doc('active-mirror', '042', 3);
            const unmirrored = doc('unmirrored', '070', 4);
            inProgress.mockResolvedValue({ documents: [hidden, revokedMirror] });
            completed.mockResolvedValue({ documents: [hidden, activeMirror] });
            rejected.mockResolvedValue({ documents: [hidden, unmirrored] });
            findMany.mockResolvedValue([
                { document_id: hidden.id, status_type },
                { document_id: revokedMirror.id, status_type: '042' },
                { document_id: activeMirror.id, status_type: '060' },
            ]);

            const result = await service.getAllDocuments(TOKEN);

            expect(result).toEqual({
                documents: [unmirrored, activeMirror, revokedMirror], total_rows: 3, limit: 100, skip: 0,
            });
            expect(revokedMirror.current_status.status_type).toBe('060');
            expect(activeMirror.current_status.status_type).toBe('042');
            expect(findMany).toHaveBeenCalledTimes(1);
            expect(findMany).toHaveBeenCalledWith({
                where: { document_id: { in: ['hidden', 'revoked-mirror', 'active-mirror', 'unmirrored'] } },
                select: { document_id: true, status_type: true },
            });
            expect(detail).toHaveBeenCalledTimes(2);
            expect(detail).toHaveBeenCalledWith(TOKEN, revokedMirror.id, expect.any(AbortSignal));
            expect(detail).toHaveBeenCalledWith(TOKEN, unmirrored.id, expect.any(AbortSignal));
            expect(hidden).not.toHaveProperty('contract_end_date');
        },
    );

    it('keeps the full deduplicated list and logs one fixed line if the query fails', async () => {
        const { service, findMany, inProgress, completed, rejected, detail } = createService();
        const review = doc('review', '070', 1);
        const revoked = doc('revoked', '042', 2);
        const finished = doc('finished', '003', 3);
        inProgress.mockResolvedValue({ documents: [review] });
        completed.mockResolvedValue({ documents: [finished, review] });
        rejected.mockResolvedValue({ documents: [revoked] });
        const failure = 'fixture-sensitive-query-error-body';
        findMany.mockRejectedValue(new Error(`${failure} ${TOKEN}`));
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
        const logSpies = [
            warn,
            ...(['log', 'warn', 'error', 'info', 'debug'] as const)
                .map((method) => jest.spyOn(console, method).mockImplementation(() => {})),
            ...(['log', 'error', 'debug', 'verbose'] as const)
                .map((method) => jest.spyOn(Logger.prototype, method).mockImplementation(() => {})),
        ];

        const result = await service.getAllDocuments(TOKEN);

        expect(result).toEqual({ documents: [finished, revoked, review], total_rows: 3, limit: 100, skip: 0 });
        expect(findMany).toHaveBeenCalledTimes(1);
        expect(detail).toHaveBeenCalledTimes(1);
        expect(detail).toHaveBeenCalledWith(TOKEN, review.id, expect.any(AbortSignal));
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith('mirror deleted-filter skipped');
        for (const spy of logSpies) {
            for (const args of spy.mock.calls) {
                for (const arg of args) {
                    expect(String(arg)).not.toContain(failure);
                    expect(String(arg)).not.toContain(TOKEN);
                    expect(JSON.stringify(arg)).not.toContain(failure);
                    expect(JSON.stringify(arg)).not.toContain(TOKEN);
                }
            }
        }
    });

    it('returns an empty list and skips all details if every document is deleted', async () => {
        const { service, findMany, inProgress, detail } = createService();
        inProgress.mockResolvedValue({ documents: [doc('deleted')] });
        findMany.mockResolvedValue([{ document_id: 'deleted', status_type: '049' }]);

        expect(await service.getAllDocuments(TOKEN)).toEqual({ documents: [], total_rows: 0, limit: 100, skip: 0 });
        expect(detail).not.toHaveBeenCalled();
    });

    it('keeps documents with null or unknown mirror statuses', async () => {
        const { service, findMany, inProgress } = createService();
        inProgress.mockResolvedValue({ documents: [doc('null-status', '042'), doc('unknown-status', '042')] });
        findMany.mockResolvedValue([
            { document_id: 'null-status', status_type: null },
            { document_id: 'unknown-status', status_type: 'future_status' },
        ]);

        expect((await service.getAllDocuments(TOKEN)).total_rows).toBe(2);
    });
});
