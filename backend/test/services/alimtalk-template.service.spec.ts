import { AlimtalkTemplateService } from "application/services/alimtalk-template.service";
import { IAligoApiPort } from "domain/ports/aligo-api.port";
import { CreateAlimtalkTemplateDto } from "interface/dto/alimtalk-template.dto";

describe("AlimtalkTemplateService", () => {
    const createMockAligoApi = (): jest.Mocked<IAligoApiPort> => ({
        sendAlimtalk: jest.fn(),
        createTemplate: jest.fn(),
        listTemplates: jest.fn(),
    });

    const createDto = (overrides: Partial<CreateAlimtalkTemplateDto> = {}): CreateAlimtalkTemplateDto => ({
        name: "배송완료 안내",
        tplType: "BA",
        tplEmType: "NONE",
        content: "#{고객명}님 배송이 완료되었습니다.",
        buttons: [],
        ...overrides,
    });

    const createImageFile = (overrides: Partial<Express.Multer.File> = {}): Express.Multer.File =>
        ({
            fieldname: "image",
            originalname: "template.png",
            encoding: "7bit",
            mimetype: "image/png",
            size: 5,
            destination: "",
            filename: "template.png",
            path: "",
            stream: undefined as never,
            buffer: Buffer.from("image"),
            ...overrides,
        }) as Express.Multer.File;

    let service: AlimtalkTemplateService;
    let aligoApi: jest.Mocked<IAligoApiPort>;

    beforeEach(() => {
        aligoApi = createMockAligoApi();
        service = new AlimtalkTemplateService(aligoApi);
    });

    it("should forward template type, emphasis, advert and image to Aligo", async () => {
        aligoApi.createTemplate.mockResolvedValue({
            code: 0,
            message: "success",
        });

        const image = createImageFile();
        await service.create(
            createDto({
                tplType: "MI",
                tplEmType: "IMAGE",
                extra: "추가 정보",
                advert: "수신거부: 고객센터",
            }),
            image,
        );

        expect(aligoApi.createTemplate).toHaveBeenCalledWith(
            expect.objectContaining({
                templateType: "MI",
                emphasisType: "IMAGE",
                extra: "추가 정보",
                advert: "수신거부: 고객센터",
                image: expect.objectContaining({
                    filename: "template.png",
                    mimeType: "image/png",
                }),
            }),
        );
    });

    it("should require extra information for EX and MI templates", async () => {
        await expect(
            service.create(
                createDto({
                    tplType: "EX",
                    extra: "",
                }),
            ),
        ).rejects.toThrow("부가 정보형(EX)과 복합형(MI) 템플릿은 부가 정보를 입력해야 합니다.");
    });

    it("should require a title for TEXT emphasis templates", async () => {
        await expect(
            service.create(
                createDto({
                    tplEmType: "TEXT",
                    title: "",
                }),
            ),
        ).rejects.toThrow("강조표기형(TEXT) 템플릿은 강조 제목을 입력해야 합니다.");
    });

    it("should require an image for IMAGE emphasis templates", async () => {
        await expect(
            service.create(
                createDto({
                    tplEmType: "IMAGE",
                }),
            ),
        ).rejects.toThrow("이미지형(IMAGE) 템플릿은 JPEG 또는 PNG 이미지를 업로드해야 합니다.");
    });

    it("should require both web links for WL buttons", async () => {
        await expect(
            service.create(
                createDto({
                    buttons: [
                        {
                            name: "상세 보기",
                            linkType: "WL",
                            linkM: "https://example.com",
                            linkP: "",
                            linkI: "",
                            linkA: "",
                        },
                    ],
                }),
            ),
        ).rejects.toThrow("버튼 1의 웹링크는 모바일/PC 링크를 모두 입력해야 합니다.");
    });

    it("should surface Aligo business errors as bad requests", async () => {
        aligoApi.createTemplate.mockResolvedValue({
            code: -99,
            message: "템플릿 검수 요청에 실패했습니다.",
        });

        await expect(service.create(createDto())).rejects.toThrow("템플릿 검수 요청에 실패했습니다.");
    });
});
