import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";

import { RegisterDto } from "interface/dto/email-auth.dto";

describe("RegisterDto", () => {
    it("rejects names containing numbers or symbols", async () => {
        const dto = plainToInstance(RegisterDto, {
            email: "user@example.com",
            password: "Password1!",
            name: "홍길동123!",
            phone: "010-1234-5678",
            birthDate: "1990-01-01",
        });

        const errors = await validate(dto);

        expect(errors.some((error) => error.property === "name")).toBe(true);
    });

    it("trims valid names before validation", async () => {
        const dto = plainToInstance(RegisterDto, {
            email: "user@example.com",
            password: "Password1!",
            name: "  홍길동  ",
            phone: "010-1234-5678",
            birthDate: "1990-01-01",
        });

        const errors = await validate(dto);

        expect(errors).toHaveLength(0);
        expect(dto.name).toBe("홍길동");
    });

    it("rejects branch and role fields from an email registration request", async () => {
        const pipe = new GlobalValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        });

        await expect(pipe.transform({
            email: "user@example.com",
            password: "Password1!",
            name: "홍길동",
            phone: "010-1234-5678",
            birthDate: "1990-01-01",
            branchId: "550e8400-e29b-41d4-a716-446655440000",
            role: "admin",
        }, {
            type: "body",
            metatype: RegisterDto,
        })).rejects.toMatchObject({ status: 400 });
    });
});
