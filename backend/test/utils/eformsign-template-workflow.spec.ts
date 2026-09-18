import {
    EformsignTemplateWorkflowError,
    parseEformsignTemplateWorkflow,
} from "application/utils/eformsign-template-workflow";

const TEMPLATE_ID = "template-1";

function step(
    seq: number | string | undefined,
    type: string,
    stepGroup: number,
    option: Record<string, unknown> = {},
): Record<string, unknown> {
    return { seq, type, step_group: stepGroup, option };
}

function config(
    steps: Array<Record<string, unknown>>,
    formId: string = TEMPLATE_ID,
): Record<string, unknown> {
    return {
        form_id: formId,
        config: { step_settings: steps },
    };
}

describe("parseEformsignTemplateWorkflow", () => {
    it("sorts shuffled numeric and string provider sequences without using array indexes", () => {
        const workflow = parseEformsignTemplateWorkflow(config([
            step("4", "complete", 4),
            step(2, "participant", 2),
            step("1", "write", 1),
            step(3, "participant", 3),
        ]), TEMPLATE_ID);

        expect(workflow.steps.map(({ seq, type }) => ({ seq, type }))).toEqual([
            { seq: "1", type: "write" },
            { seq: "2", type: "participant" },
            { seq: "3", type: "participant" },
            { seq: "4", type: "complete" },
        ]);
        expect(workflow.recipients).toEqual([
            { seq: "2", type: "participant", identity: "customer" },
            { seq: "3", type: "participant", identity: "institution" },
        ]);
    });

    it.each([
        ["write,participant,participant,complete", ["write", "participant", "participant", "complete"]],
        ["write,participant,reviewer,complete", ["write", "participant", "reviewer", "complete"]],
        [
            "write,participant,participant,reviewer,complete",
            ["write", "participant", "participant", "reviewer", "complete"],
        ],
    ])("accepts the approved %s topology", (_name, types) => {
        const steps = (types as string[]).map((type, index) => step(index + 1, type, index + 1,
            type === "reviewer" && types.length === 5
                ? {
                    use_receipient_specified: true,
                    specified_recipient_type: "beforewriter",
                    specified_recipient_seq: "3",
                    receipients: [{ group: { id: "must-not-be-copied" } }],
                }
                : {},
        ));

        const workflow = parseEformsignTemplateWorkflow(config(steps), TEMPLATE_ID);
        expect(workflow.recipients).toEqual(
            types.length === 4
                ? [
                    { seq: "2", type: "participant", identity: "customer" },
                    { seq: "3", type: types[2] === "reviewer" ? "reviewer" : "participant", identity: "institution" },
                ]
                : [
                    { seq: "2", type: "participant", identity: "customer" },
                    { seq: "3", type: "participant", identity: "institution" },
                    { seq: "4", type: "reviewer", identity: "institution" },
                ],
        );
    });

    it.each([
        ["missing sequence", [step(1, "write", 1), step(undefined, "complete", 2)]],
        ["duplicate sequence", [step(1, "write", 1), step(1, "complete", 2)]],
        ["parallel step groups", [step(1, "write", 1), step(2, "complete", 1)]],
        ["unknown step kind", [step(1, "write", 1), step(2, "participant", 2), step(3, "mystery", 3), step(4, "complete", 4)]],
        ["mismatched form id", [step(1, "write", 1), step(2, "participant", 2), step(3, "participant", 3), step(4, "complete", 4)]],
        ["malformed settings", []],
    ])("rejects %s", (name, steps) => {
        const value = name === "mismatched form id"
            ? config(steps as Array<Record<string, unknown>>, "another-template")
            : config(steps as Array<Record<string, unknown>>);
        expect(() => parseEformsignTemplateWorkflow(value, TEMPLATE_ID)).toThrow(EformsignTemplateWorkflowError);
    });

    it("rejects a five-step reviewer that does not explicitly inherit the institution participant", () => {
        expect(() => parseEformsignTemplateWorkflow(config([
            step(1, "write", 1),
            step(2, "participant", 2),
            step(3, "participant", 3),
            step(4, "reviewer", 4, {
                use_receipient_specified: true,
                specified_recipient_type: "beforewriter",
                specified_recipient_seq: "2",
            }),
            step(5, "complete", 5),
        ]), TEMPLATE_ID)).toThrow(EformsignTemplateWorkflowError);
    });
});
