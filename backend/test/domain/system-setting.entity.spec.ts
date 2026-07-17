import { SystemSettingEntity } from "domain/entities/system-setting.entity";

describe("SystemSettingEntity", () => {
    it("creates and updates a generic system setting", () => {
        const entity = SystemSettingEntity.create("ribbon_config", "{}");
        const createdAt = entity.updatedAt.getTime();

        entity.update('{"enabled":true}');

        expect(entity.key).toBe("ribbon_config");
        expect(entity.value).toBe('{"enabled":true}');
        expect(entity.updatedAt.getTime()).toBeGreaterThanOrEqual(createdAt);
    });

    it("keeps the ribbon setting key stable", () => {
        expect(SystemSettingEntity.RIBBON_CONFIG_KEY).toBe("ribbon_config");
    });
});
