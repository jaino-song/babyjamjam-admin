import {
    SystemSettingEntity,
    AlimtalkProvider,
    ALIMTALK_PROVIDERS,
} from "domain/entities/system-setting.entity";

describe("SystemSettingEntity", () => {
    const createSystemSettingProps = (overrides = {}) => ({
        key: "alimtalk_provider",
        value: "aligo_alimtalk",
        updatedAt: new Date("2025-01-14T00:00:00Z"),
        ...overrides,
    });

    describe("constructor", () => {
        it("should create a valid system setting entity", () => {
            const props = createSystemSettingProps();

            const entity = new SystemSettingEntity(props.key, props.value, props.updatedAt);

            expect(entity.key).toBe("alimtalk_provider");
            expect(entity.value).toBe("aligo_alimtalk");
            expect(entity.updatedAt).toEqual(props.updatedAt);
        });
    });

    describe("create", () => {
        it("should create a new system setting with current timestamp", () => {
            const beforeCreate = new Date();

            const entity = SystemSettingEntity.create("alimtalk_provider", "aligo_alimtalk");

            expect(entity.key).toBe("alimtalk_provider");
            expect(entity.value).toBe("aligo_alimtalk");
            expect(entity.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
        });
    });

    describe("createAlimtalkProviderSetting", () => {
        describe("given valid provider value", () => {
            it.each([...ALIMTALK_PROVIDERS] as const)(
                "should create setting with provider '%s'",
                (provider: AlimtalkProvider) => {
                    const entity = SystemSettingEntity.createAlimtalkProviderSetting(provider);

                    expect(entity.key).toBe("alimtalk_provider");
                    expect(entity.value).toBe(provider);
                }
            );
        });

        describe("given invalid provider value", () => {
            it("should throw InvalidAlimtalkProviderError", () => {
                expect(() =>
                    SystemSettingEntity.createAlimtalkProviderSetting(
                        "invalid" as AlimtalkProvider
                    )
                ).toThrow(
                    "Invalid alimtalk provider: invalid. Valid values are: aligo_alimtalk, none"
                );
            });

            it("should throw for empty string", () => {
                expect(() =>
                    SystemSettingEntity.createAlimtalkProviderSetting("" as AlimtalkProvider)
                ).toThrow("Invalid alimtalk provider");
            });
        });
    });

    describe("update", () => {
        it("should update value and timestamp", () => {
            const entity = new SystemSettingEntity(
                "alimtalk_provider",
                "aligo_alimtalk",
                new Date("2025-01-01T00:00:00Z")
            );
            const beforeUpdate = new Date();

            entity.update("none");

            expect(entity.value).toBe("none");
            expect(entity.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
        });
    });

    describe("isAlimtalkProvider", () => {
        it("should return true when key is alimtalk_provider", () => {
            const entity = new SystemSettingEntity("alimtalk_provider", "aligo_alimtalk", new Date());

            expect(entity.isAlimtalkProvider()).toBe(true);
        });

        it("should return false for other keys", () => {
            const entity = new SystemSettingEntity("other_setting", "some_value", new Date());

            expect(entity.isAlimtalkProvider()).toBe(false);
        });
    });

    describe("getAlimtalkProvider", () => {
        describe("given alimtalk_provider setting", () => {
            it.each([...ALIMTALK_PROVIDERS] as const)(
                "should return '%s' as AlimtalkProvider",
                (provider: AlimtalkProvider) => {
                    const entity = new SystemSettingEntity(
                        "alimtalk_provider",
                        provider,
                        new Date()
                    );

                    expect(entity.getAlimtalkProvider()).toBe(provider);
                }
            );
        });

        describe("given non-alimtalk_provider setting", () => {
            it("should throw error", () => {
                const entity = new SystemSettingEntity("other_key", "aligo_alimtalk", new Date());

                expect(() => entity.getAlimtalkProvider()).toThrow(
                    "Cannot get alimtalk provider from non-alimtalk_provider setting"
                );
            });
        });

        describe("given invalid stored value", () => {
            it("should throw error for invalid provider value", () => {
                const entity = new SystemSettingEntity("alimtalk_provider", "invalid", new Date());

                expect(() => entity.getAlimtalkProvider()).toThrow("Invalid alimtalk provider");
            });
        });
    });

    describe("ALIMTALK_PROVIDER_KEY constant", () => {
        it("should be 'alimtalk_provider'", () => {
            expect(SystemSettingEntity.ALIMTALK_PROVIDER_KEY).toBe("alimtalk_provider");
        });
    });

    describe("DEFAULT_ALIMTALK_PROVIDER constant", () => {
        it("should be 'aligo_alimtalk'", () => {
            expect(SystemSettingEntity.DEFAULT_ALIMTALK_PROVIDER).toBe("aligo_alimtalk");
        });
    });
});
