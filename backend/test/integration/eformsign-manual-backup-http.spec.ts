import { EventEmitter } from 'node:events';
import { ArgumentsHost, ExecutionContext, HttpException, INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { json, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { EformsignManualBackupService } from 'application/services/eformsign-manual-backup.service';
import { EformsignBackupExportService } from 'application/services/eformsign-backup-export.service';
import { ManualBackupControlError, type ManualBackupControlCode } from 'domain/eformsign-backup/manual-backup-control';
import { ExportError, EXPORT_ERRORS, type ExportErrorCode } from 'domain/eformsign-backup/export';
import { JwtGuard } from 'infrastructure/auth/jwt.guard';
import type { EformsignBackupExportRequest } from 'infrastructure/auth/eformsign-backup-export.guard';
import { PrismaService } from 'infrastructure/database/prisma.service';
import { SbEformsignBackupRunRepository } from 'infrastructure/database/repositories/sb.eformsign-backup-run.repository';
import { SbEformsignBackupExportCredentialRepository } from 'infrastructure/database/repositories/sb.eformsign-backup-export-credential.repository';
import { EformsignManualBackupWorkerController } from 'interface/controllers/eformsign-manual-backup-worker.controller';
import { EformsignManualBackupFilter } from 'interface/filters/eformsign-manual-backup.filter';
import { EformsignBackupExportModule } from 'module/eformsign-backup-export.module';

const A = '10000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000010';
const ID = '20000000-0000-4000-8000-000000000001';
const STAFF = '/eformsign-backups/runs';
const MACHINE = '/internal/eformsign-backup/v1/manual-runs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const scope = { period: 'all', start: '', end: '', kind: 'all', contractStages: ['created'], recordStages: ['created'] };

describe('manual HTTP boundaries (repository isolated; native fixture proves real sessions)', () => {
    let app: INestApplication;
    const repository = {
        expireStale: jest.fn(async () => undefined), listForBranch: jest.fn(async () => ({ items: [], hasMore: false })),
        findForBranch: jest.fn(async () => null), findByRequestKey: jest.fn(async () => null),
        readSourceForRequest: jest.fn(async () => ({ observedAt: new Date(), documents: [], files: [] })),
        claimNext: jest.fn(async () => null),
    };
    beforeAll(async () => {
        const module = await Test.createTestingModule({
            imports: [EformsignBackupExportModule],
        }).overrideProvider(PrismaService).useValue({ branch: { findUnique: async () => ({ isActive: true }) },
            user_branch: { findFirst: async ({ where }: { where: { userId: string } }) => ({ branch: { isActive: true }, role: where.userId === USER ? 'manager' : 'user' }) } })
            .overrideProvider(ConfigService).useValue({ get: (key: string) => key === 'EFORMSIGN_COMPANY_ID' ? 'company' : undefined })
            .overrideProvider(SbEformsignBackupRunRepository).useValue(repository)
            .overrideProvider(EformsignBackupExportService).useValue({})
            .overrideProvider(SbEformsignBackupExportCredentialRepository).useValue({
                findActiveByTokenHash: async () => ({ id: 'credential', principalId: 'worker', companyIds: ['company'] }), touchLastUsed: async () => undefined,
            }).overrideGuard(JwtGuard).useValue({
            canActivate(ctx: ExecutionContext) {
                const req = ctx.switchToHttp().getRequest();
                const role = req.headers['x-test-role'];
                if (!role) throw new UnauthorizedException('private');
                req.user = { userId: role === 'viewer' || role === 'admin-only' ? ID : USER,
                    role: role === 'owner' ? 'owner' : role === 'admin-only' ? 'admin' : 'user',
                    branchId: role === 'pending' ? undefined : A };
                return true;
            },
        }).compile();
        app = module.createNestApplication({ logger: false });
        // Match main.ts: the explicit parser is installed before module configure.
        app.use(json({ limit: '1mb' }));
        app.use((req: Request, _res: Response, next: NextFunction) => {
            // Exercise errors reaching the same pre-controller boundary without
            // changing production controllers or parser policy.
            const kind = req.headers['x-test-error'];
            if (kind === 'control') next(new ManualBackupControlError('RUN_ACTIVE'));
            else if (kind === 'export') next(new ExportError('UNAUTHORIZED'));
            else if (kind === 'http') next(new HttpException('PRIVATE_TOKEN', 403));
            else if (kind === 'unknown') next(new Error('PRIVATE_TOKEN'));
            else if (kind === 'syntax') next(new SyntaxError('PRIVATE_TOKEN'));
            else next();
        });
        await app.init();
    });
    afterAll(async () => { await app.close(); });
    beforeEach(() => { jest.clearAllMocks(); });
    function errorBody(res: request.Response, status: number, code: string) {
        expect(res.status).toBe(status);
        expect(res.body).toEqual({ code, requestId: expect.stringMatching(uuid) });
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.headers['x-request-id']).toBe(res.body.requestId);
    }
    it.each([STAFF, STAFF + '/' + ID + '/documents?limit=1', MACHINE, MACHINE + '/claim/nested'])
    ('sanitizes malformed JSON at %s with and without credentials before guards run', async path => {
        const sentinel = 'PRIVATE_BODY_TOKEN_DO_NOT_REFLECT_7b14';
        for (const authenticated of [false, true]) {
            const req = request(app.getHttpServer()).post(path).set('Content-Type', 'application/json');
            if (authenticated) req.set('x-test-role', 'owner').set('Authorization', 'Bearer ebx_' + 'A'.repeat(43));
            const res = await req.send('{"private":"' + sentinel + '","scope":INVALID}');
            errorBody(res, 400, 'INVALID_REQUEST');
            expect(Object.keys(res.body).sort()).toEqual(['code', 'requestId']);
            expect(JSON.stringify({ body: res.body, headers: res.headers })).not.toContain(sentinel);
        }
        expect(repository.expireStale).not.toHaveBeenCalled();
        expect(repository.readSourceForRequest).not.toHaveBeenCalled();
        expect(repository.claimNext).not.toHaveBeenCalled();
    });
    it.each<[string, number, string]>([
        ['control', 409, 'RUN_ACTIVE'], ['export', 401, 'UNAUTHORIZED'], ['http', 403, 'FORBIDDEN'],
        ['unknown', 503, 'SERVICE_UNAVAILABLE'], ['syntax', 503, 'SERVICE_UNAVAILABLE'],
    ])('preserves safe mapping for %s errors reached before controllers', async (kind, status, code) => {
        for (const path of [STAFF, MACHINE]) {
            const res = await request(app.getHttpServer()).post(path).set('x-test-error', kind);
            errorBody(res, status, code);
            expect(res.text).not.toContain('PRIVATE_TOKEN');
        }
    });
    it.each(['/unrelated-api', STAFF + '-other', MACHINE + '-other', '/internal/eformsign-backup/v1/snapshots'])
    ('preserves default parser errors outside the exact manual prefix segments at %s', async path => {
        const res = await request(app.getHttpServer()).post(path).set('Content-Type', 'application/json').send('{"scope":');
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ statusCode: 400, error: 'Bad Request', message: expect.any(String) });
        expect(res.body.code).toBeUndefined();
        expect(res.body.requestId).toBeUndefined();
        expect(res.headers['cache-control']).toBeUndefined();
        expect(res.headers['x-request-id']).toBeUndefined();
    });
    it('covers staff guard failures with the safe filter', async () => {
        errorBody(await request(app.getHttpServer()).get(STAFF), 401, 'UNAUTHORIZED');
        for (const role of ['viewer', 'admin-only', 'pending']) errorBody(await request(app.getHttpServer()).get(STAFF).set('x-test-role', role), 403, 'FORBIDDEN');
        expect(repository.expireStale).not.toHaveBeenCalled();
    });
    it('uses verified context and ignores a spoofed branch header', async () => {
        const res = await request(app.getHttpServer()).get(STAFF).set('x-test-role', 'manager').set('X-Branch-Id', ID);
        expect(res.status).toBe(200); expect(res.body).toEqual({ items: [], nextCursor: null });
        expect(repository.listForBranch).toHaveBeenCalledWith({ companyId: 'company', branchId: A, limit: 100 });
        expect(res.headers['x-request-id']).toMatch(uuid);
    });
    it('rejects unknown authority and query fields before repository writes', async () => {
        for (const extra of ['companyId', 'branchId', 'actor', 'authority', 'documentIds']) {
            errorBody(await request(app.getHttpServer()).post(STAFF).set('x-test-role', 'owner')
                .send({ scope, requestKey: 'test', [extra]: 'private' }), 400, 'INVALID_REQUEST');
        }
        errorBody(await request(app.getHttpServer()).get(STAFF + '?branchId=' + ID).set('x-test-role', 'owner'), 400, 'INVALID_REQUEST');
        errorBody(await request(app.getHttpServer()).get(STAFF + '?limit=101').set('x-test-role', 'owner'), 400, 'INVALID_REQUEST');
        expect(repository.expireStale).not.toHaveBeenCalled();
        expect(repository.readSourceForRequest).not.toHaveBeenCalled();
    });
    it('returns a safe empty selection and strict UUID failures', async () => {
        errorBody(await request(app.getHttpServer()).post(STAFF).set('x-test-role', 'owner').send({ scope, requestKey: 'test' }), 400, 'EMPTY_SELECTION');
        errorBody(await request(app.getHttpServer()).get(STAFF + '/bad').set('x-test-role', 'owner'), 400, 'INVALID_REQUEST');
        errorBody(await request(app.getHttpServer()).get(STAFF + '/' + ID).set('x-test-role', 'owner'), 404, 'NOT_FOUND');
    });
    it('rejects missing machine credentials using the unchanged real ExportGuard', async () => {
        errorBody(await request(app.getHttpServer()).post(MACHINE + '/claim').send({ companyId: 'company' }), 401, 'UNAUTHORIZED');
        expect(repository.claimNext).not.toHaveBeenCalled();
    });
    it('returns a literal JSON null claim, and validates the company with the real service', async () => {
        const bearer = 'Bearer ebx_' + 'A'.repeat(43);
        const res = await request(app.getHttpServer()).post(MACHINE + '/claim').set('Authorization', bearer).send({ companyId: 'company' });
        expect(res.status).toBe(200); expect(res.text).toBe('null');
        errorBody(await request(app.getHttpServer()).post(MACHINE + '/claim').set('Authorization', bearer).send({ companyId: 'foreign' }), 404, 'NOT_FOUND');
    });
});

describe('safe manual filter catalog', () => {
    function filtered(error: unknown) {
        const response = { headersSent: false, destroyed: false, setHeader: jest.fn(), status: jest.fn(), json: jest.fn() };
        response.status.mockReturnValue(response);
        new EformsignManualBackupFilter().catch(error, { switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => response }) } as ArgumentsHost);
        return response;
    }
    it.each<[ManualBackupControlCode, number]>([['INVALID_REQUEST', 400], ['EMPTY_SELECTION', 400], ['NOT_FOUND', 404], ['IDEMPOTENCY_CONFLICT', 409],
        ['RUN_ACTIVE', 409], ['SOURCE_CHANGED', 409], ['LEASE_LOST', 409], ['DOCUMENT_RESULTS_PENDING', 409], ['INVALID_REPORT', 409], ['SERVICE_UNAVAILABLE', 503]])('maps %s to %s', (code, status) => {
        const res = filtered(new ManualBackupControlError(code)); expect(res.status).toHaveBeenCalledWith(status);
        expect(res.json).toHaveBeenCalledWith({ code, requestId: expect.stringMatching(uuid) });
    });
    it('preserves all existing ExportError statuses but exposes only code and UUID', () => {
        for (const code of Object.keys(EXPORT_ERRORS) as ExportErrorCode[]) {
            const res = filtered(new ExportError(code, { reasonCode: 'private', retryAfterSeconds: 2 }));
            expect(res.status).toHaveBeenCalledWith(EXPORT_ERRORS[code].status);
            expect(res.json).toHaveBeenCalledWith({ code, requestId: expect.stringMatching(uuid) });
        }
    });
    it.each([new Error('private URL and token'), new HttpException('private', 500)])('hides unknown causes', error => {
        const res = filtered(error); expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith({ code: 'SERVICE_UNAVAILABLE', requestId: expect.stringMatching(uuid) });
    });
});

describe('manual artifact response lifetime', () => {
    it.each(['close', 'error', 'destroyed', 'write-failure'])('releases exactly once for %s', async event => {
        const release = jest.fn();
        const service = { readArtifact: async () => ({ release, bytes: Buffer.from('pdf'), contentType: 'application/pdf', sha256: 'a'.repeat(64), artifactIdentity: 'b'.repeat(64) }) };
        const controller = new EformsignManualBackupWorkerController(service as unknown as EformsignManualBackupService);
        const res = Object.assign(new EventEmitter(), { destroyed: event === 'destroyed', headersSent: false,
            setHeader: jest.fn(), status: jest.fn(), end: jest.fn(() => { if (event === 'write-failure') throw new Error('private'); }), destroy: jest.fn() });
        const req = { eformsignBackupExportPrincipal: { credentialId: 'credential', principalId: 'worker', companyIds: ['company'] } } as unknown as EformsignBackupExportRequest;
        const action = controller.artifact(req, res as unknown as Response, ID, {});
        if (event === 'write-failure') await expect(action).rejects.toThrow(); else await action;
        if (event === 'close' || event === 'error') res.emit(event);
        res.emit('close'); expect(release).toHaveBeenCalledTimes(1);
        expect(res.end).toHaveBeenCalledTimes(event === 'destroyed' ? 0 : 1);
    });
});
