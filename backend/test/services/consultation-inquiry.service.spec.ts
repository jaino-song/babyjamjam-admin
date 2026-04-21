import { BadRequestException, NotFoundException } from "@nestjs/common";

import { ConsultationInquiryService } from "application/services/consultation-inquiry.service";
import { ConsultationInquiryEntity } from "domain/entities/consultation-inquiry.entity";
import { IConsultationInquiryRepository } from "domain/repositories/consultation-inquiry.repository.interface";

describe("ConsultationInquiryService", () => {
    const createRepository = (): jest.Mocked<IConsultationInquiryRepository> => ({
        findActiveBranchBySlug: jest.fn(),
        create: jest.fn(),
        findManyByBranch: jest.fn(),
    });

    const createInquiry = (): ConsultationInquiryEntity => ({
        id: "inq-1",
        branchId: "branch-1",
        publicBranchSlug: "incheon-yeonsu",
        motherName: "김지은",
        phone: "010-1234-5678",
        address: "인천 연수구",
        dueDate: new Date("2026-05-01"),
        birthExperience: "초산",
        voucherType: null,
        preferredCaregiverName: null,
        referralSource: "검색",
        privacyAcceptedAt: new Date("2026-04-21T00:00:00.000Z"),
        source: "website",
        status: "new",
        createdAt: new Date("2026-04-21T00:00:00.000Z"),
        updatedAt: new Date("2026-04-21T00:00:00.000Z"),
        branchName: "인천 연수구점",
    });

    let repository: jest.Mocked<IConsultationInquiryRepository>;
    let service: ConsultationInquiryService;

    beforeEach(() => {
        repository = createRepository();
        service = new ConsultationInquiryService(repository);
    });

    it("should create public inquiry when branch exists and privacy is accepted", async () => {
        const inquiry = createInquiry();
        repository.findActiveBranchBySlug.mockResolvedValue({
            id: "branch-1",
            name: "인천 연수구점",
            slug: "incheon-yeonsu",
        });
        repository.create.mockResolvedValue(inquiry);

        const result = await service.createPublicInquiry({
            branchSlug: "incheon-yeonsu",
            motherName: "김지은",
            phone: "010-1234-5678",
            address: "인천 연수구",
            dueDate: "2026-05-01",
            birthExperience: "초산",
            referralSource: "검색",
            privacyAccepted: true,
        });

        expect(result).toBe(inquiry);
        expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
            branchId: "branch-1",
            publicBranchSlug: "incheon-yeonsu",
            motherName: "김지은",
            status: "new",
            source: "website",
        }));
    });

    it("should reject public inquiry when privacy is not accepted", async () => {
        await expect(service.createPublicInquiry({
            branchSlug: "incheon-yeonsu",
            motherName: "김지은",
            phone: "010-1234-5678",
            address: "인천 연수구",
            dueDate: "2026-05-01",
            birthExperience: "초산",
            referralSource: "검색",
            privacyAccepted: false,
        })).rejects.toBeInstanceOf(BadRequestException);
    });

    it("should reject public inquiry when branch is missing", async () => {
        repository.findActiveBranchBySlug.mockResolvedValue(null);

        await expect(service.createPublicInquiry({
            branchSlug: "unknown",
            motherName: "김지은",
            phone: "010-1234-5678",
            address: "인천 연수구",
            dueDate: "2026-05-01",
            birthExperience: "초산",
            referralSource: "검색",
            privacyAccepted: true,
        })).rejects.toBeInstanceOf(NotFoundException);
    });

    it("should list branch-scoped inquiries with defaults", async () => {
        const inquiry = createInquiry();
        repository.findManyByBranch.mockResolvedValue({ data: [inquiry], total: 1 });

        const result = await service.listForBranch("branch-1", {});

        expect(repository.findManyByBranch).toHaveBeenCalledWith({
            branchId: "branch-1",
            page: 1,
            limit: 20,
            search: undefined,
            status: "all",
        });
        expect(result).toEqual({
            data: [inquiry],
            total: 1,
            page: 1,
            limit: 20,
            totalPages: 1,
        });
    });
});
