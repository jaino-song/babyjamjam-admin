import { SbAuthTokenRepository } from "infrastructure/database/repositories/sb.auth-token.repository";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("SbAuthTokenRepository", () => {
    it.each([
        [1, true],
        [0, false],
    ])("should return %s only when one valid token is atomically consumed", async (count, expected) => {
        const updateMany = jest.fn().mockResolvedValue({ count });
        const tx = { auth_token: { updateMany } };
        const repository = new SbAuthTokenRepository({} as PrismaService);

        await expect(repository.consumeWithinTx(
            tx as never,
            "hashed-token",
            "password_reset",
        )).resolves.toBe(expected);

        expect(updateMany).toHaveBeenCalledWith({
            where: {
                token: "hashed-token",
                type: "password_reset",
                usedAt: null,
                expiresAt: { gt: expect.any(Date) },
            },
            data: { usedAt: expect.any(Date) },
        });
        const [{ where, data }] = updateMany.mock.calls[0];
        expect(where.expiresAt.gt).toBe(data.usedAt);
    });
});
