export interface AligoAlimtalkResponse {
    code: number;
    message: string;
    info?: {
        type: string;
        mid: number;
        current: string;
        unit: number;
        total: number;
        scnt: number;
        fcnt: number;
    };
}

export interface AligoTemplateCreateResponse {
    code: number;
    message: string;
    info?: Record<string, unknown>;
}

export interface AligoSendAlimtalkParams {
    tplCode: string;
    receiver: string;
    subject: string;
    message: string;
    buttonJson?: string;
    failoverYn?: "Y" | "N";
    failoverSubject?: string;
    failoverMessage?: string;
}

export interface AligoTemplateButtonPayload {
    name: string;
    linkType: "WL" | "AL" | "BK" | "MD" | "DS" | "AC";
    linkM?: string;
    linkP?: string;
    linkI?: string;
    linkA?: string;
}

export interface AligoTemplateImagePayload {
    buffer: Buffer;
    filename: string;
    mimeType: string;
}

export interface AligoCreateTemplateParams {
    templateName: string;
    templateContent: string;
    templateType: "BA" | "EX" | "AD" | "MI";
    emphasisType: "NONE" | "TEXT" | "IMAGE";
    title?: string;
    subtitle?: string;
    extra?: string;
    advert?: string;
    buttons?: AligoTemplateButtonPayload[];
    image?: AligoTemplateImagePayload;
}

export interface AligoTemplateListButton {
    name: string;
    linkType: "WL" | "AL" | "BK" | "MD" | "DS" | "AC";
    linkM?: string;
    linkP?: string;
    linkI?: string;
    linkA?: string;
    ordering?: string;
}

export interface AligoTemplateListItem {
    templtCode: string;
    templtName: string;
    templtContent: string;
    templtTitle?: string;
    templtSubtitle?: string;
    templtType: "BA" | "EX" | "AD" | "MI";
    emphasizeType: "NONE" | "TEXT" | "IMAGE";
    templtExtra?: string;
    templtAd?: string;
    inspStatus?: string;
    status?: string;
    ctgCategory?: string;
    buttons?: AligoTemplateListButton[];
    createDate?: string;
    updateDate?: string;
    senderKey?: string;
}

export interface AligoTemplateListResponse {
    code: number;
    message: string;
    list?: AligoTemplateListItem[];
}

export interface IAligoApiPort {
    sendAlimtalk(params: AligoSendAlimtalkParams): Promise<AligoAlimtalkResponse>;
    createTemplate(params: AligoCreateTemplateParams): Promise<AligoTemplateCreateResponse>;
    listTemplates(): Promise<AligoTemplateListResponse>;
}

export const ALIGO_API_PORT = Symbol("ALIGO_API_PORT");
