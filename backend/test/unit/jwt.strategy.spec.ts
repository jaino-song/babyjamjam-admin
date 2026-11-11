import { UnauthorizedException } from "@nestjs/common";
import { JwtStrategy } from "infrastructure/auth/jwt.strategy";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("JwtStrategy.validate", () => {
    const findUnique = jest.fn();
    const payload = { sub: "staff-id", role: "owner", type: "access" as const };
    const originalSecret = process.env['JWT_SECRET'];
    let strategy: JwtStrategy;

    beforeEach(() => {
        process.env['JWT_SECRET'] = "test-secret";
        findUnique.mockReset();
        strategy = new JwtStrategy({ user: { findUnique } } as unknown as PrismaService);
    });

    afterAll(() => {
        if (originalSecret === undefined) delete process.env['JWT_SECRET'];
        else process.env['JWT_SECRET'] = originalSecret;
    });

    it("rejects a non-access token before querying the database", async () => {
        await expect(strategy.validate({ ...payload, type: "refresh" }))
            .rejects.toBeInstanceOf(UnauthorizedException);
        expect(findUnique).not.toHaveBeenCalled();
    });

    it("rejects a missing user", async () => {
        findUnique.mockResolvedValue(null);
        await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it.each(["user", null, "unknown"])("rejects DB role %s", async (role) => {
        findUnique.mockResolvedValue({ id: "staff-id", role });
        await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it.each(["owner", "admin", "manager"])("accepts DB role %s and returns the DB principal", async (role) => {
        findUnique.mockResolvedValue({ id: "db-user-id", role });
        await expect(strategy.validate(payload)).resolves.toEqual({ userId: "db-user-id", role });
        expect(findUnique).toHaveBeenCalledWith({
            where: { id: "staff-id" },
            select: { id: true, role: true },
        });
    });
});
