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

export interface IAligoApiPort {
    sendAlimtalk(params: AligoSendAlimtalkParams): Promise<AligoAlimtalkResponse>;
}

export const ALIGO_API_PORT = Symbol("ALIGO_API_PORT");
