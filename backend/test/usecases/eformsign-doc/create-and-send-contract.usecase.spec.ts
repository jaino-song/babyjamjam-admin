import { CreateAndSendContractUsecase } from "application/usecases/eformsign-doc/create-and-send-contract.usecase";

describe("CreateAndSendContractUsecase", () => {
    it("does not create an external document for an unassigned client", async () => {
        const eformsignClient = { createDocument: jest.fn() };
        const clientRepository = {
            findById: jest.fn().mockResolvedValue({
                id: 55,
                name: "송진호",
                phone: "010-1111-2222",
            }),
        };
        const assignmentGuard = {
            assertAssignedClient: jest.fn().mockRejectedValue(
                new Error("고객의 제공인력 배정을 먼저 저장해 주세요."),
            ),
        };
        const usecase = new CreateAndSendContractUsecase(
            eformsignClient as never,
            clientRepository as never,
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            assignmentGuard as never,
        );

        await expect(usecase.execute("branch-1", {
            clientId: 55,
            templateId: "template-1",
        })).resolves.toEqual({
            success: false,
            error: "고객의 제공인력 배정을 먼저 저장해 주세요.",
        });

        expect(assignmentGuard.assertAssignedClient).toHaveBeenCalledWith("branch-1", 55);
        expect(eformsignClient.createDocument).not.toHaveBeenCalled();
    });
});
