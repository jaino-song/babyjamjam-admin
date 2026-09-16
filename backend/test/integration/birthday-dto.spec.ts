import "reflect-metadata";
import { ConfirmNewClientFieldsDto } from "interface/dto/call-inbox.dto";
import { validate } from "class-validator";
import { CreateClientDto, UpdateClientDto } from "interface/dto/client.dto";
import { CreateEmployeeDto, UpdateEmployeeDto } from "interface/dto/employee.dto";

const dtoTypes = [CreateClientDto, UpdateClientDto, CreateEmployeeDto, UpdateEmployeeDto, ConfirmNewClientFieldsDto];

describe.each(dtoTypes)("%p birthday boundary", (Dto) => {
    async function birthdayErrors(birthday: unknown) {
        const dto = Object.assign(new Dto(), { birthday });
        return (await validate(dto)).filter((error) => error.property === "birthday");
    }

    it.each(["1958-03-03", "1905-01-01", "2005-01-01", "2000-02-29", "580303", null, undefined])(
        "accepts canonical or existing legacy birthday %s without changing the year", async (birthday) => {
            expect(await birthdayErrors(birthday)).toEqual([]);
        },
    );
    it.each(["19580303", "58-03-03", "1958-3-3", "2058-03-03", "1900-02-29", "2005-02-29", "900231", "1958-13-03", 19580303])(
        "rejects invalid birthday %s", async (birthday) => {
            expect(await birthdayErrors(birthday)).not.toHaveLength(0);
        },
    );
});

it.each([CreateEmployeeDto, UpdateEmployeeDto])("keeps %p optional birthday clearing compatible", async (Dto) => {
    const dto = Object.assign(new Dto(), { birthday: "" });
    expect((await validate(dto)).filter((error) => error.property === "birthday")).toEqual([]);
});
