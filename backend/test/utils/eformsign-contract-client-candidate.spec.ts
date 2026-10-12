import {
    eformsignCustomerPhone,
    extractEformsignContractClientCandidate,
    extractEformsignContractClientPrefillCandidate,
} from "application/utils/eformsign-contract-client-candidate";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";

function documentDetail(
    overrides: Partial<EformsignApiDocumentResponse> = {},
): EformsignApiDocumentResponse {
    return {
        id: "doc-1",
        document_number: "DOC-1",
        template: { id: "contract-template", name: "계약서" },
        document_name: "산모신생아 건강관리 계약서",
        creator: { recipient_type: "01", id: "staff@example.com", name: "담당자" },
        created_date: Date.parse("2026-07-01T00:00:00.000Z"),
        updated_date: Date.parse("2026-07-02T00:00:00.000Z"),
        current_status: {
            status_type: "072",
            step_type: "06",
            step_index: "3",
            step_name: "완료",
            step_recipients: [{
                recipient_type: "06",
                id: "provider@example.com",
                name: "제공기관",
                sms: "010-9999-9999",
            }],
            step_group: 3,
        },
        fields: [
            { id: "이용자 성명", value: "김고객", type: "text" },
            // This field can contain the issuing staff's number in the current template.
            { id: "이용자 연락처", value: "010-8888-8888", type: "text" },
            { id: "이용자 생년월일", value: "1992-03-04", type: "date" },
            { id: "이용자 주소", value: "서울시 중구", type: "text" },
            { id: "계약 시작 년도", value: "2026", type: "text" },
            { id: "계약 시작 월", value: "08", type: "text" },
            { id: "계약 시작 일", value: "01", type: "text" },
            { id: "계약 종료 년도", value: "2026", type: "text" },
            { id: "계약 종료 월", value: "08", type: "text" },
            { id: "계약 종료 일", value: "14", type: "text" },
            { id: "서비스 비용", value: "1,500,000원", type: "text" },
            { id: "정부지원금", value: "1,000,000원", type: "text" },
            { id: "본인부담금", value: "500,000원", type: "text" },
            { id: "서비스 일수", value: "15일", type: "text" },
        ],
        recipients: [{
            recipient_type: "02",
            name: "김고객",
            sms: "010-1234-5678",
        }],
        ...overrides,
    };
}

describe("extractEformsignContractClientCandidate", () => {
    describe.each([
        ["prefill", extractEformsignContractClientPrefillCandidate],
        ["identity", extractEformsignContractClientCandidate],
    ] as const)("customer-safe birthday (%s)", (_kind, extract) => {
        it.each([
            "산모신생아 이용자 생년월일",
            "산모 신생아 이용자 생년월일",
            "산모_신생아 이용자 생년월일",
            "산모신생아 산모신생아 이용자 생년월일",
        ])("preserves a service-prefixed id-token birthday (%s)", (id) => {
            const detail = documentDetail({
                fields: [
                    { id: "이용자 성명", value: "김고객", type: "text" },
                    { id, value: "1992-03-04", type: "text" },
                ],
            });

            expect(extract(detail)?.birthday).toBe("1992-03-04");
        });

        it.each([
            "산모신생아 건강관리 계약",
            "산모 신생아 건강관리 계약",
        ])("preserves a keyed birthday below a service container (%s)", (parent) => {
            const detail = documentDetail({
                fields: [],
                detail_template_info: [{
                    field_values: {
                        "이용자 성명": "김고객",
                        [parent]: { "이용자 생년월일": "1992-03-04" },
                    },
                }],
            });

            expect(extract(detail)?.birthday).toBe("1992-03-04");
        });

        it.each([
            "산모신생아 신생아 주민번호 앞자리",
            "산모신생아 신생아 생년월일",
            "산모신생아 providerBirthday",
            "산모·신생아 이용자 생년월일",
        ])("rejects a still-marked service-prefixed birthday (%s)", (id) => {
            const detail = documentDetail({
                fields: [
                    { id: "이용자 성명", value: "김고객", type: "text" },
                    { id, value: "900101", type: "text" },
                ],
            });

            expect(extract(detail)?.birthday).toBeNull();
        });

        it.each([
            "제공인력 주민번호 앞자리",
            "providerBirthday",
            "신생아 주민번호 앞자리",
            "babyBirthday",
            "배우자 주민번호 앞자리",
            "아기 주민번호 앞자리",
            "자녀 주민번호 앞자리",
            "보호자 주민번호 앞자리",
            "childBirthday",
            "spouseBirthday",
            "guardianBirthday",
            "PROVIDER_birthday",
        ])("rejects a non-customer id-token birthday (%s)", (id) => {
            const detail = documentDetail({
                fields: [
                    { id: "이용자 성명", value: "김고객", type: "text" },
                    { id, value: id === "providerBirthday" ? "1990-01-01" : "900101", type: "text" },
                ],
            });

            expect(extract(detail)?.birthday).toBeNull();
        });

        it.each(["제공인력", "provider", "신생아", "guardian"])(
            "rejects a keyed birthday below a marked ancestor (%s)",
            (parent) => {
                const detail = documentDetail({
                    fields: [],
                    detail_template_info: [{
                        field_values: {
                            "이용자 성명": "김고객",
                            [parent]: { "생년월일": "1990-01-01" },
                        },
                    }],
                });

                expect(extract(detail)?.birthday).toBeNull();
            },
        );

        it("rejects a customer alias when another id token identifies a provider", () => {
            const detail = documentDetail({
                fields: [
                    { id: "이용자 성명", value: "김고객", type: "text" },
                    { id: "birthday", ...{ label: "provider" }, value: "900101", type: "text" },
                ],
            });

            expect(extract(detail)?.birthday).toBeNull();
        });

        it("continues past a provider id-token to a customer birthday", () => {
            const detail = documentDetail({
                fields: [
                    { id: "providerBirthday", value: "900101", type: "text" },
                    ...(documentDetail().fields ?? []),
                ],
            });

            expect(extract(detail)?.birthday).toBe("1992-03-04");
        });

        it("continues from a provider id-token to a customer keyed in the next source", () => {
            const detail = documentDetail({
                fields: [{ id: "providerBirthday", value: "900101", type: "text" }],
                detail_template_info: [{
                    field_values: {
                        "이용자 성명": "김고객",
                        "이용자 생년월일": "1992-03-04",
                    },
                }],
            });

            expect(extract(detail)?.birthday).toBe("1992-03-04");
        });

        it("continues past a marked keyed subtree to an unmarked customer value", () => {
            const detail = documentDetail({
                fields: [],
                detail_template_info: [{
                    field_values: {
                        "이용자 성명": "김고객",
                        provider: { birthday: { value: "900101" } },
                        customer: { birthday: { value: "1992-03-04" } },
                    },
                }],
            });

            expect(extract(detail)?.birthday).toBe("1992-03-04");
        });

        it("rejects a birthday through nested objects and arrays below a marked ancestor", () => {
            const detail = documentDetail({
                fields: [],
                detail_template_info: [{
                    field_values: {
                        "이용자 성명": "김고객",
                        provider: { nested: [{ birthday: { value: "900101" } }] },
                    },
                }],
            });

            expect(extract(detail)?.birthday).toBeNull();
        });

        it.each(["생년월일", "이용자 생년월일", "customerDOB", "birthday"])(
            "preserves an unmarked id-token birthday (%s)",
            (id) => {
                const detail = documentDetail({
                    fields: [
                        { id: "이용자 성명", value: "김고객", type: "text" },
                        { id, value: "1992-03-04", type: "text" },
                    ],
                });

                expect(extract(detail)?.birthday).toBe("1992-03-04");
            },
        );

        it("preserves keyed-before-id and fields-before-detail precedence", () => {
            const detail = documentDetail({
                fields: [{ id: "birthday", value: "900101", type: "text" }],
                detail_template_info: [{
                    field_values: {
                        "이용자 성명": "김고객",
                        birthday: "1992-03-04",
                    },
                }],
            });

            expect(extract(detail)?.birthday).toBe("1990-01-01");

            detail.detail_template_info = {
                "이용자 성명": "김고객",
                record: { id: "birthday", value: "900101" },
                nested: { birthday: { value: "1992-03-04" } },
            };
            detail.fields = [];
            expect(extract(detail)?.birthday).toBe("1992-03-04");
        });
    });

    it.each([
        ["1905-01-01", "1905-01-01"],
        ["580303", "1958-03-03"],
        ["1986.7.9", "1986-07-09"],
        ["1986년 7월 9일", "1986-07-09"],
        ["1986. 7. 9.", "1986-07-09"],
        ["1986 07 09", "1986-07-09"],
        ["86.07.09", "1986-07-09"],
        ["86.7.9", "1986-07-09"],
        ["１９８６．７．９", "1986-07-09"],
        ["1986-07-09 00:00:00", "1986-07-09"],
        ["1986-07-09T23:00:00-09:00", "1986-07-09"],
        ["1986-07-09Tgarbage", null],
        ["860709abc", null],
        ["1986111", null],
        ["07/09/1986", null],
        ["860709-2******", null],
        ["2099-07-09", null],
        ["1986.07/09", null],
        ["1986.07.09", "1986-07-09"],
        ["1986-7-9", "1986-07-09"],
        ["1986/7/9", "1986-07-09"],
        ["19860709", "1986-07-09"],
        ["860709", "1986-07-09"],
        ["2000.2.29", "2000-02-29"],
        ["1986.2.30", null],
        ["1986.02.30", null],
        ["198679", null],
    ])("normalizes document birthday %s for registration", (raw, expected) => {
        const detail = documentDetail();
        detail.fields = detail.fields?.map((field) => field.id === "이용자 생년월일"
            ? { ...field, value: raw }
            : field);
        expect(extractEformsignContractClientPrefillCandidate(detail)?.birthday).toBe(expected);
    });

    it("maps the final contract detail and prefers the named customer recipient phone", () => {
        const candidate = extractEformsignContractClientCandidate(documentDetail());

        expect(candidate).toEqual(expect.objectContaining({
            name: "김고객",
            phone: "01012345678",
            address: "서울시 중구",
            birthday: "1992-03-04",
            duration: 15,
            fullPrice: "1500000",
            grant: "1000000",
            actualPrice: "500000",
            voucherClient: true,
        }));
        expect(candidate?.startDate?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
        expect(candidate?.endDate?.toISOString()).toBe("2026-08-14T00:00:00.000Z");
    });

    it("extracts both provider identities for branch-scoped employee resolution", () => {
        const detail = documentDetail({
            fields: [
                ...(documentDetail().fields ?? []),
                { id: "제공인력 1 성명", value: "김희선", type: "text" },
                { id: "제공인력 1 연락처", value: "82 10 5330 9359", type: "text" },
                { id: "제공인력2 성명", value: "이보조", type: "text" },
                { id: "제공인력2 연락처", value: "010-2222-3333", type: "text" },
            ],
        });

        expect(extractEformsignContractClientPrefillCandidate(detail)).toEqual(
            expect.objectContaining({
                primaryProviderName: "김희선",
                primaryProviderPhone: "01053309359",
                secondaryProviderName: "이보조",
                secondaryProviderPhone: "01022223333",
            }),
        );
    });

    it("does not guess when the same named recipient has conflicting phones", () => {
        const detail = documentDetail({
            recipients: [
                { recipient_type: "02", name: "김고객", sms: "010-1234-5678" },
                { recipient_type: "02", name: "김고객", sms: "010-7777-7777" },
            ],
        });

        expect(eformsignCustomerPhone(detail)).toBeNull();
        expect(extractEformsignContractClientCandidate(detail)).toBeNull();
    });

    it("does not mistake the current provider recipient for the customer", () => {
        const detail = documentDetail({
            recipients: [],
            fields: documentDetail().fields?.filter((field) => field.id !== "이용자 연락처"),
        });

        expect(eformsignCustomerPhone(detail)).toBeNull();
    });

    it("uses the customer-qualified name when a provider name field comes first", () => {
        const detail = documentDetail({
            fields: [
                { id: "제공자 성명", value: "제공자", type: "text" },
                { id: "고객 성명", value: "김고객", type: "text" },
            ],
            recipients: [
                { recipient_type: "06", name: "제공자", sms: "010-9999-9999" },
                { recipient_type: "02", name: "김고객", sms: "010-1234-5678" },
            ],
        });

        expect(extractEformsignContractClientCandidate(detail)).toEqual(
            expect.objectContaining({
                name: "김고객",
                phone: "01012345678",
            }),
        );
    });

    it("rejects a generic-only name field as unsafe for auto-registration", () => {
        const detail = documentDetail({
            fields: [{ id: "성명", value: "김고객", type: "text" }],
        });

        expect(extractEformsignContractClientCandidate(detail)).toBeNull();
    });

    it("keeps the legacy customer_name alias eligible for auto-registration", () => {
        const detail = documentDetail({
            fields: [],
            detail_template_info: {
                customer_name: { value: "김고객" },
            },
        });

        expect(extractEformsignContractClientCandidate(detail)).toEqual(
            expect.objectContaining({
                name: "김고객",
                phone: "01012345678",
            }),
        );
    });

    it.each([
        ["이용자 생년월일", "1986. 7. 9."],
        ["생년월일", "1986-07-09"],
    ])(
        "extracts birthday from keyed detail field maps returned by document APIs (%s)",
        (fieldId, rawBirthday) => {
            const detail = documentDetail({
                fields: [],
                detail_template_info: [{
                    field_values: {
                        "이용자 성명": "김고객",
                        [fieldId]: rawBirthday,
                    },
                }],
            });

            expect(extractEformsignContractClientPrefillCandidate(detail)).toEqual(
                expect.objectContaining({
                    name: "김고객",
                    birthday: "1986-07-09",
                }),
            );
        },
    );

    it("normalizes a nested keyed birthday value wrapper", () => {
        const detail = documentDetail({
            fields: [],
            detail_template_info: [{
                field_values: {
                    "이용자 성명": "김고객",
                    "이용자 생년월일": { value: "1986-07-09" },
                },
            }],
        });

        expect(extractEformsignContractClientPrefillCandidate(detail)).toEqual(
            expect.objectContaining({
                name: "김고객",
                birthday: "1986-07-09",
            }),
        );
    });

    it("uses the exact 본인부담금 keyed value after receipt date keys", () => {
        const detail = documentDetail({
            fields: [],
            detail_template_info: [{
                field_values: {
                    "이용자 성명": "김고객",
                    "본인부담금 수령 년도": "2026",
                    "본인부담금 수령 월": "08",
                    "본인부담금 수령 일": "14",
                    "본인부담금": "500,000원",
                },
            }],
        });

        expect(extractEformsignContractClientPrefillCandidate(detail)?.actualPrice)
            .toBe("500000");
    });

    it("does not infer actualPrice from receipt date keys without exact 본인부담금", () => {
        const detail = documentDetail({
            fields: [],
            detail_template_info: [{
                field_values: {
                    "이용자 성명": "김고객",
                    "본인부담금 수령 년도": "2026",
                    "본인부담금 수령 월": "08",
                    "본인부담금 수령 일": "14",
                },
            }],
        });

        expect(extractEformsignContractClientPrefillCandidate(detail)?.actualPrice)
            .toBeNull();
    });
});
