import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("AppModule", () => {
    it("should register message template routes", () => {
        const source = readFileSync(join(process.cwd(), "app.module.ts"), "utf8");

        expect(source).toContain('import { MessageTemplateModule } from "module/message-template.module";');
        expect(source).toMatch(/imports:\s*\[[\s\S]*MessageTemplateModule[\s\S]*\]/);
    });
});
