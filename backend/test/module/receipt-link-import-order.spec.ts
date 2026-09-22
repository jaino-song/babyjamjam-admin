import "reflect-metadata";

describe("Receipt link provider import order", () => {
    it.each([
        "application/services/eformsign-document-mirror.service",
        "application/services/message-trigger.service",
        "application/services/receipt-link-issue.service",
    ])("retains the mirror injection token when %s loads first", (entrypoint) => {
        jest.isolateModules(() => {
            require(entrypoint);
            const { ReceiptLinkIssueService } = require("application/services/receipt-link-issue.service");
            const { EformsignDocumentMirrorService } = require("application/services/eformsign-document-mirror.service");

            const dependencies = Reflect.getMetadata("design:paramtypes", ReceiptLinkIssueService);
            expect(dependencies[3]).toBe(EformsignDocumentMirrorService);
        });
    });
});
