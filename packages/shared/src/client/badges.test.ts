import { legacyClientBadges } from "./badges";

describe("legacyClientBadges contract status", () => {
    it("shows 계약서 필요 for an active client whose contract is not completed and not revoke-requested", () => {
        const badges = legacyClientBadges({ serviceStatus: "active", documentStatus: "revoked" });
        expect(badges.some((badge) => badge.key === "contract_required")).toBe(true);
    });

    it("renders a revoke-requested (040/045) contract as the 철회 요청됨 warning badge, never 계약서 필요", () => {
        const badges = legacyClientBadges({ serviceStatus: "active", documentStatus: "revoke_requested" });

        expect(badges.some((badge) => badge.key === "contract_required")).toBe(false);
        // Its own key, first, warning tone; the real service-status badge stays, once.
        expect(badges.map((badge) => [badge.key, badge.label, badge.tone])).toEqual([
            ["contract_status", "철회 요청됨", "warning"],
            ["service_status", "진행중", "primary"],
        ]);
        expect(new Set(badges.map((badge) => badge.key)).size).toBe(badges.length);
    });

    it("does not add the warning badge for a completed contract or a non-active service", () => {
        expect(legacyClientBadges({ serviceStatus: "active", documentStatus: "completed" })
            .some((badge) => badge.label === "철회 요청됨")).toBe(false);
        expect(legacyClientBadges({ serviceStatus: "pre_booking", documentStatus: "revoke_requested" })
            .some((badge) => badge.label === "철회 요청됨")).toBe(false);
    });
});
