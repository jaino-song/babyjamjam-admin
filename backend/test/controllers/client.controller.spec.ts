import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { ClientService } from "application/services/client.service";
import { ClientController } from "interface/controllers/client.controller";
import { CreateClientDto, CreateClientWithEmployeeActivationDto, UpdateClientDto } from "interface/dto/client.dto";

describe("ClientController document linking boundary", () => {
    const createBody = { name: "Client", voucherClient: false, breastPump: false };
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

    it.each([
        ["create", CreateClientDto, createBody],
        ["create with employee activation", CreateClientWithEmployeeActivationDto, { ...createBody, confirmedUnavailableEmployeeIds: [1] }],
        ["update", UpdateClientDto, { name: "Updated" }],
    ])("rejects eDocId on %s without changing stored document ownership", async (_, metatype, body) => {
        let storedEDocId = "owned-document";
        const service = {
            create: jest.fn().mockImplementation(async (_branch, params) => { storedEDocId = params.eDocId; }),
            update: jest.fn().mockImplementation(async (_branch, _id, params) => { storedEDocId = params.eDocId; }),
        };
        const controller = new ClientController(service as unknown as ClientService);
        const attempt = async () => {
            const dto = await pipe.transform({ ...body, eDocId: "another-branch-document" }, { type: "body", metatype });
            if (metatype === UpdateClientDto) return controller.update({ branchId: "branch-1" }, 1, dto);
            return controller.create({ branchId: "branch-1" }, dto);
        };

        await expect(attempt()).rejects.toBeInstanceOf(BadRequestException);
        expect(service.create).not.toHaveBeenCalled();
        expect(service.update).not.toHaveBeenCalled();
        expect(storedEDocId).toBe("owned-document");
    });

    it("does not forward eDocId even if a DTO is supplied directly", () => {
        const service = { create: jest.fn(), update: jest.fn() };
        const controller = new ClientController(service as unknown as ClientService);
        controller.create({ branchId: "branch-1" }, { ...createBody, eDocId: "untrusted" } as CreateClientDto);
        controller.update({ branchId: "branch-1" }, 1, { name: "Updated", eDocId: "untrusted" } as UpdateClientDto);

        expect(service.create.mock.calls[0][1]).not.toHaveProperty("eDocId");
        expect(service.update.mock.calls[0][2]).not.toHaveProperty("eDocId");
    });
});
