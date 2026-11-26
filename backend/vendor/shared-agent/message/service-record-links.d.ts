export declare const SERVICE_RECORD_LINK_DEFAULT_TEMPLATE = "[\uC0AC\uD68C\uC11C\uBE44\uC2A4 \uC81C\uACF5\uC790 \uD488\uC9C8\uD3C9\uAC00 A\uB4F1\uAE09]\n\uC548\uB155\uD558\uC138\uC694, \uC778\uCC9C \uC544\uC774\uBBF8\uB798\uB85C \uC785\uB2C8\uB2E4 :)\n\n{{employeeName}} \uAD00\uB9AC\uC0AC\uB2D8, {{clientName}} \uC0B0\uBAA8\uB2D8\uC758 {{serviceStartDate}} \uC2DC\uC791 \uC11C\uBE44\uC2A4 \uC81C\uACF5\uAE30\uB85D\uC9C0 \uC791\uC131 \uB9C1\uD06C\uC785\uB2C8\uB2E4.\n\uB9E4\uC77C \uC11C\uBE44\uC2A4 \uC81C\uACF5 \uC644\uB8CC \uC9C1\uC804\uC5D0 \uC11C\uBE44\uC2A4 \uC138\uBD80\uC0AC\uD56D \uAE30\uB85D \uD6C4\uC5D0, \uC0B0\uBAA8\uB2D8\uAED8 \uC2B9\uC778\uC744 \uBC1B\uC73C\uC2DC\uBA74 \uB429\uB2C8\uB2E4.\n\n\uCD5C\uCD08 \uC811\uC18D \uC2DC\uC5D0 \uAD00\uB9AC\uC0AC\uB2D8\uC758 \uC804\uD654\uBC88\uD638 \uC778\uC99D\uC774 \uD544\uC694\uD569\uB2C8\uB2E4. \uB9C1\uD06C \uC811\uC18D \uD6C4 \uD734\uB300\uD3F0 \uBC88\uD638\uB85C \uBCF8\uC778\uD655\uC778\uD558\uACE0, \uBC29\uBB38\uC77C\uB9C8\uB2E4 \uAE30\uB85D\uC744 \uB0A8\uACA8\uC8FC\uC138\uC694.\n\n\uAC10\uC0AC\uD569\uB2C8\uB2E4.\n\n\uC81C\uACF5\uAE30\uB85D\uC9C0 \uB9C1\uD06C\n{{serviceRecordUrl}}";
export interface ServiceRecordLinkMember {
    /** One-based active-baby ordinal. A legacy singleton may omit the rank with null. */
    readonly activeRank: number | null;
    readonly url: string;
}
export interface RenderServiceRecordLinksInput {
    readonly template: string;
    readonly variables: Readonly<Record<string, unknown>>;
    readonly householdBabyCount: number | null;
    readonly members: readonly ServiceRecordLinkMember[];
}
export type RenderServiceRecordLinksResult = {
    ok: true;
    content: string;
    buttonUrl: string | null;
} | {
    ok: false;
    reason: "invalid_template" | "invalid_members" | "missing_link_placeholder" | "message_too_large";
};
export declare function renderServiceRecordLinks(input: RenderServiceRecordLinksInput): RenderServiceRecordLinksResult;
