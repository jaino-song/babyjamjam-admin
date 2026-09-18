import { HttpException } from "@nestjs/common";
import { UpdateMessageUsecase } from "application/usecases/message/update-message.usecase";
import { MarkNotificationReadUsecase } from "application/usecases/notification/mark-notification-read.usecase";
import { GetVersionContentUseCase } from "application/usecases/system-template/get-version-content.usecase";
import { RollbackToVersionUseCase } from "application/usecases/system-template/rollback-to-version.usecase";
import { DeleteUserUsecase } from "application/usecases/user/delete-user.usecase";
import { UpdateVoucherPriceInfoUsecase } from "application/usecases/voucher-price-info/update-voucher-price-info.usecase";
import { ParseVoucherImageUsecase } from "application/usecases/voucher-price-info/parse-voucher-image.usecase";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import { NotificationEntity } from "domain/entities/notification.entity";

/** EM v1.0: every rejection below must carry a registered problem code. */
async function rejectedBody(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        return (error as HttpException).getResponse();
    }
    throw new Error("Expected the usecase to reject");
}

describe("BJJ-319 6.1b usecase problem contract", () => {
    it("update-message NotFound carries RESOURCE_NOT_FOUND", async () => {
        const usecase = new UpdateMessageUsecase({ findById: jest.fn().mockResolvedValue(null) } as never);
        const body = await rejectedBody(usecase.execute("branch-a", 5, "t", "b"));
        expect(body).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    });

    it("mark-notification-read missing notification carries RESOURCE_NOT_FOUND", async () => {
        const usecase = new MarkNotificationReadUsecase({ findById: jest.fn().mockResolvedValue(null) } as never);
        const body = await rejectedBody(usecase.execute("branch-a", 7, "user-a"));
        expect(body).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    });

    it("mark-notification-read ownership mismatch stays a 404 problem", async () => {
        const notification = NotificationEntity.reconstitute(
            7, "user-other", "알림", "본문", {}, new Date(), null,
        );
        const usecase = new MarkNotificationReadUsecase({ findById: jest.fn().mockResolvedValue(notification) } as never);
        try {
            await usecase.execute("branch-a", 7, "user-a");
            throw new Error("Expected the usecase to reject");
        } catch (error) {
            expect(error).toBeInstanceOf(HttpException);
            expect((error as HttpException).getStatus()).toBe(404);
            expect((error as HttpException).getResponse()).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
        }
    });

    it("get-version-content NotFound carries RESOURCE_NOT_FOUND", async () => {
        const usecase = new GetVersionContentUseCase({ getVersionByNumber: jest.fn().mockResolvedValue(null) } as never);
        const body = await rejectedBody(usecase.execute(SystemTemplateKey.CLIENT_WELCOME, 3));
        expect(body).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    });

    it("rollback-to-version missing version carries RESOURCE_NOT_FOUND", async () => {
        const repository = { getVersionByNumber: jest.fn().mockResolvedValue(null) } as never;
        const automationLock = { runExclusive: jest.fn(async (_key: unknown, work: (tx: never) => Promise<unknown>) => work({} as never)) } as never;
        const usecase = new RollbackToVersionUseCase(repository, { assertValid: jest.fn() } as never, automationLock);
        const body = await rejectedBody(usecase.execute(SystemTemplateKey.CLIENT_WELCOME, 3, "user-a"));
        expect(body).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    });

    it("delete-user missing membership carries RESOURCE_NOT_FOUND", async () => {
        const usecase = new DeleteUserUsecase({ deleteMembership: jest.fn().mockResolvedValue(false) } as never);
        const body = await rejectedBody(usecase.execute("user-a", "branch-a"));
        expect(body).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    });

    it("update-voucher-price-info NotFound carries RESOURCE_NOT_FOUND", async () => {
        const usecase = new UpdateVoucherPriceInfoUsecase({ findById: jest.fn().mockResolvedValue(null) } as never);
        const body = await rejectedBody(usecase.execute(9, { type: "A통합1형" }));
        expect(body).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    });

    it("parse-voucher-image file rejections carry VALIDATION_FAILED with /file", async () => {
        const usecase = new ParseVoucherImageUsecase({} as never);
        const missing = await rejectedBody(usecase.execute(undefined as never));
        expect(missing).toMatchObject({ code: "VALIDATION_FAILED" });

        const badMime = await rejectedBody(usecase.execute({
            buffer: Buffer.from("x"), originalname: "a.txt", mimetype: "text/plain", size: 10,
        } as never));
        expect(badMime).toMatchObject({ code: "VALIDATION_FAILED" });

        const tooBig = await rejectedBody(usecase.execute({
            buffer: Buffer.from("x"), originalname: "a.png", mimetype: "image/png", size: 11 * 1024 * 1024,
        } as never));
        expect(tooBig).toMatchObject({ code: "VALIDATION_FAILED" });
    });
});
