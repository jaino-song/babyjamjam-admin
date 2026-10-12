import { ExecutionContext, INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { EformsignDocService } from "application/services/eformsign-doc.service";
import { EformsignDocsEventBus } from "application/services/eformsign-docs-event-bus.service";
import { EformsignHeadlessProgressService } from "application/services/eformsign-headless-progress.service";
import { EformsignDocumentJobService } from "application/services/eformsign-document-job.service";
import { DispatchDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/dispatch-document-headless.usecase";
import { FinalizeDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/finalize-document-headless.usecase";
import { AdoptEformsignDocUsecase } from "application/usecases/eformsign-doc/adopt-eformsign-doc.usecase";
import { ListClientNamesByBranchUsecase } from "application/usecases/eformsign-doc/list-client-names-by-branch.usecase";
import { ListReviewStageContractsUsecase } from "application/usecases/eformsign-doc/list-review-stage-contracts.usecase";
import { ListEformsignLinkConfirmationsUsecase, type EformsignLinkConfirmation } from "application/usecases/eformsign-doc/list-eformsign-link-confirmations.usecase";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import { EformsignDocController } from "interface/controllers/eformsign-doc.controller";

describe("EformsignDocController link-confirmations", () => {
    let app: INestApplication;
    const execute = jest.fn();
    let branchRole: string;
    let globalRole: string;
    const result: EformsignLinkConfirmation[] = [{
        documentId: "doc-1", documentName: null, statusType: "020", statusDetail: "진행",
        createdDate: "2026-09-01T00:00:00.000Z",
        document: { name: "계약산모", phone: "01012345678", birthday: "1990-01-01" },
        client: { id: 7, name: "등록산모", phone: "01012345678", birthday: null },
        differences: ["name", "birthday"],
    }];
    const guard = {
        canActivate(context: ExecutionContext) {
            context.switchToHttp().getRequest().tenant = {
                branchId: "B", userId: "staff", branchRole, globalRole,
            };
            return true;
        },
    };
    beforeAll(async () => {
        const module = await Test.createTestingModule({
            controllers: [EformsignDocController],
            providers: [
                ...[EformsignDocService, ListClientNamesByBranchUsecase, ListReviewStageContractsUsecase,
                    DispatchDocumentHeadlessUsecase, FinalizeDocumentHeadlessUsecase, AdoptEformsignDocUsecase,
                    EformsignDocsEventBus, EformsignHeadlessProgressService, ConfigService,
                    EformsignDocumentJobService].map(provide => ({ provide, useValue: {} })),
                { provide: ListEformsignLinkConfirmationsUsecase, useValue: { execute } },
            ],
        }).overrideGuard(JwtGuard).useValue(guard).overrideGuard(TenantGuard).useValue(guard).compile();
        app = module.createNestApplication();
        await app.init();
    });
    beforeEach(() => {
        branchRole = "manager"; globalRole = "staff";
        execute.mockReset().mockResolvedValue(result);
    });
    afterAll(async () => { await app.close(); });

    it("serves the static route, passes tenant and parsed clientId, preserving the result fields", async () => {
        const response = await request(app.getHttpServer()).get("/eformsign-docs/link-confirmations?clientId=7").expect(200);
        expect(execute).toHaveBeenCalledWith("B", 7);
        expect(response.body).toEqual([{ ...result[0], canConfirm: true }]);
        expect(result[0]).not.toHaveProperty("canConfirm");
    });
    it("passes undefined when clientId is omitted", async () => {
        await request(app.getHttpServer()).get("/eformsign-docs/link-confirmations").expect(200);
        expect(execute).toHaveBeenCalledWith("B", undefined);
    });
    it.each(["nope", "7x", "0", "-1", "1.5", "", "9007199254740992"])("rejects invalid clientId %s", async id => {
        await request(app.getHttpServer()).get(`/eformsign-docs/link-confirmations?clientId=${id}`).expect(400);
        expect(execute).not.toHaveBeenCalled();
    });
    it.each([
        ["manager", "staff", true], ["admin", "staff", true], ["user", "owner", true],
        ["user", "staff", false], ["", "staff", false], ["user", "admin", false],
    ])("reports adoption capability for branch %s/global %s without denying reads", async (branch, global, allowed) => {
        branchRole = branch; globalRole = global;
        const response = await request(app.getHttpServer()).get("/eformsign-docs/link-confirmations").expect(200);
        expect(response.body).toEqual([{ ...result[0], canConfirm: allowed }]);
    });
});
