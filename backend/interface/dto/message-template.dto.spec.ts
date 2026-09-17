import "reflect-metadata";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { CreateMessageTemplateDto, UpdateMessageTemplateDto } from "./message-template.dto";

describe("Message template DTO validation", () => {
    it("rejects whitespace-only name and content on create", async () => {
        const dto = plainToInstance(CreateMessageTemplateDto, {
            name: " \n\t",
            content: "\u00a0",
            variables: [],
        });

        const errors = await validate(dto);
        const constraints = errors.flatMap((error) => Object.values(error.constraints ?? {}));

        expect(constraints).toEqual(expect.arrayContaining([
            "템플릿 이름은 공백 이외의 문자를 포함해야 합니다.",
            "템플릿 내용은 공백 이외의 문자를 포함해야 합니다.",
        ]));
    });

    it("rejects whitespace-only fields when they are provided on a partial update", async () => {
        const dto = plainToInstance(UpdateMessageTemplateDto, {
            name: "   ",
            content: "\n\r",
        });

        const errors = await validate(dto);
        const constraints = errors.flatMap((error) => Object.values(error.constraints ?? {}));

        expect(constraints).toEqual(expect.arrayContaining([
            "템플릿 이름은 공백 이외의 문자를 포함해야 합니다.",
            "템플릿 내용은 공백 이외의 문자를 포함해야 합니다.",
        ]));
    });

    it("accepts omitted update fields and preserves valid multiline strings byte-for-byte", async () => {
        const name = "  QA 안내 템플릿  ";
        const content = "첫 줄\n둘째 줄\n\t셋째 줄  ";
        const dto = plainToInstance(UpdateMessageTemplateDto, { variables: [] });
        const validDto = plainToInstance(CreateMessageTemplateDto, { name, content, variables: [] });

        await expect(validate(dto)).resolves.toEqual([]);
        await expect(validate(validDto)).resolves.toEqual([]);
        expect(validDto.name).toBe(name);
        expect(validDto.content).toBe(content);
    });
});
