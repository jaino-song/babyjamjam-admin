import { CreateAndSendServiceRecordSnapshotUsecase } from "application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase";

describe("revised service-record snapshot boundary", () => {
    it("fails closed before credentials or provider calls", async () => {
        const withCredentials = jest.fn();
        const createDocument = jest.fn();
        const usecase = new CreateAndSendServiceRecordSnapshotUsecase(
            { createDocument } as never,
            {
                service_record_case: {
                    findUnique: jest.fn().mockResolvedValue({
                        branchId: "branch-1",
                        currentRevisionId: "revision-1",
                    }),
                },
            } as never,
            { withCredentials } as never,
            { get: jest.fn().mockReturnValue("template-5") } as never,
        );

        await expect(usecase.executeCase(
            "branch-1",
            "case-1",
            { branchId: "branch-1", source: "worker" } as never,
        )).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED" },
        });
        expect(withCredentials).not.toHaveBeenCalled();
        expect(createDocument).not.toHaveBeenCalled();
    });
});
