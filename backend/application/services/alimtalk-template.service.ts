import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import {
    ALIGO_API_PORT,
    AligoCreateTemplateParams,
    AligoTemplateButtonPayload,
    AligoTemplateCreateResponse,
    AligoTemplateListItem,
    IAligoApiPort,
} from "domain/ports/aligo-api.port";
import { CreateAlimtalkTemplateDto, CreateAlimtalkTemplateButtonDto } from "interface/dto/alimtalk-template.dto";

const ALLOWED_TEMPLATE_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png"]);

export interface AlimtalkTemplateListItemDto {
    templateCode: string;
    name: string;
    content: string;
    title?: string;
    subtitle?: string;
    extra?: string;
    advert?: string;
    templateType: "BA" | "EX" | "AD" | "MI";
    emphasisType: "NONE" | "TEXT" | "IMAGE";
    inspectionStatus?: string;
    isApproved: boolean;
    category?: string;
    buttons: Array<{
        name: string;
        linkType: string;
        linkM?: string;
        linkP?: string;
        linkI?: string;
        linkA?: string;
    }>;
    createdAt?: string;
    updatedAt?: string;
    senderKey?: string;
}

@Injectable()
export class AlimtalkTemplateService {
    private readonly logger = new Logger(AlimtalkTemplateService.name);

    constructor(
        @Inject(ALIGO_API_PORT)
        private readonly aligoApi: IAligoApiPort
    ) {}

    async list(): Promise<AlimtalkTemplateListItemDto[]> {
        const result = await this.aligoApi.listTemplates();
        if (result.code !== 0) {
            throw new BadRequestException(result.message || "알리고 템플릿 목록 조회에 실패했습니다.");
        }
        return (result.list ?? []).map((item) => this.mapTemplateListItem(item));
    }

    private mapTemplateListItem(item: AligoTemplateListItem): AlimtalkTemplateListItemDto {
        return {
            templateCode: item.templtCode,
            name: item.templtName,
            content: item.templtContent,
            title: item.templtTitle || undefined,
            subtitle: item.templtSubtitle || undefined,
            extra: item.templtExtra || undefined,
            advert: item.templtAd || undefined,
            templateType: item.templtType,
            emphasisType: item.emphasizeType,
            inspectionStatus: item.inspStatus || undefined,
            isApproved: item.inspStatus === "APR",
            category: item.ctgCategory || undefined,
            buttons: (item.buttons ?? []).map((button) => ({
                name: button.name,
                linkType: button.linkType,
                linkM: button.linkM || undefined,
                linkP: button.linkP || undefined,
                linkI: button.linkI || undefined,
                linkA: button.linkA || undefined,
            })),
            createdAt: item.createDate || undefined,
            updatedAt: item.updateDate || undefined,
            senderKey: item.senderKey || undefined,
        };
    }

    async create(dto: CreateAlimtalkTemplateDto, image?: Express.Multer.File) {
        this.validateDto(dto, image);

        const payload: AligoCreateTemplateParams = {
            templateName: dto.name.trim(),
            templateContent: this.normalizeText(dto.content),
            templateType: dto.tplType,
            emphasisType: dto.tplEmType,
            title: this.normalizeOptionalText(dto.title),
            subtitle: this.normalizeOptionalText(dto.subtitle),
            extra: this.normalizeOptionalText(dto.extra),
            advert: this.normalizeOptionalText(dto.advert),
            buttons: this.buildButtons(dto.buttons),
            image: image
                ? {
                    buffer: image.buffer,
                    filename: image.originalname,
                    mimeType: image.mimetype,
                }
                : undefined,
        };

        this.logger.debug(`[AlimtalkTemplate] Creating template ${payload.templateName}`);

        const result = await this.aligoApi.createTemplate(payload);
        this.ensureSuccessfulResponse(result);
        return result;
    }

    private validateDto(dto: CreateAlimtalkTemplateDto, image?: Express.Multer.File) {
        if ((dto.tplType === "EX" || dto.tplType === "MI") && !dto.extra?.trim()) {
            throw new BadRequestException("부가 정보형(EX)과 복합형(MI) 템플릿은 부가 정보를 입력해야 합니다.");
        }

        if ((dto.tplType === "AD" || dto.tplType === "MI") && !dto.advert?.trim()) {
            throw new BadRequestException("광고 추가형(AD)과 복합형(MI) 템플릿은 광고 문구를 입력해야 합니다.");
        }

        if (dto.tplEmType === "TEXT" && !dto.title?.trim()) {
            throw new BadRequestException("강조표기형(TEXT) 템플릿은 강조 제목을 입력해야 합니다.");
        }

        if (dto.tplEmType === "IMAGE" && !image) {
            throw new BadRequestException("이미지형(IMAGE) 템플릿은 JPEG 또는 PNG 이미지를 업로드해야 합니다.");
        }

        if (dto.tplEmType !== "IMAGE" && image) {
            throw new BadRequestException("이미지 업로드는 이미지형(IMAGE) 강조 유형에서만 사용할 수 있습니다.");
        }

        if (image && !ALLOWED_TEMPLATE_IMAGE_TYPES.has(image.mimetype)) {
            throw new BadRequestException("템플릿 이미지는 JPEG 또는 PNG 파일만 업로드할 수 있습니다.");
        }

        const variableMatches = dto.content.match(/#\{[^}]+\}/g) ?? [];
        const variableSet = new Set(variableMatches);
        if (variableSet.size !== variableMatches.length) {
            throw new BadRequestException("본문 내 치환 변수명이 중복됩니다. 변수명은 고유해야 합니다.");
        }

        dto.buttons.forEach((button, index) => this.validateButton(button, index));
    }

    private validateButton(button: CreateAlimtalkTemplateButtonDto, index: number) {
        if (button.linkType === "WL" && (!button.linkM?.trim() || !button.linkP?.trim())) {
            throw new BadRequestException(`버튼 ${index + 1}의 웹링크는 모바일/PC 링크를 모두 입력해야 합니다.`);
        }

        if (button.linkType === "AL" && (!button.linkI?.trim() || !button.linkA?.trim())) {
            throw new BadRequestException(`버튼 ${index + 1}의 앱링크는 iOS/Android 스킴을 모두 입력해야 합니다.`);
        }
    }

    private normalizeText(value: string): string {
        return value.replace(/\r\n/g, "\n").trim();
    }

    private normalizeOptionalText(value?: string) {
        if (!value) return undefined;

        const normalized = this.normalizeText(value);
        return normalized.length > 0 ? normalized : undefined;
    }

    private ensureSuccessfulResponse(result: AligoTemplateCreateResponse) {
        if (result.code === 0) return;

        throw new BadRequestException(result.message || "알리고 템플릿 등록 요청이 실패했습니다.");
    }

    private buildButtons(buttons: CreateAlimtalkTemplateButtonDto[]): AligoTemplateButtonPayload[] | undefined {
        if (buttons.length === 0) return undefined;

        return buttons.map((button) => ({
            name: button.name.trim(),
            linkType: button.linkType,
            linkM: button.linkM?.trim() || undefined,
            linkP: button.linkP?.trim() || undefined,
            linkI: button.linkI?.trim() || undefined,
            linkA: button.linkA?.trim() || undefined,
        }));
    }
}
