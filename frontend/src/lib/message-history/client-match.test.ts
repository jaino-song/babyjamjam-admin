import {
  findMessageHistoryClient,
  matchesMessageHistoryClient,
} from "./client-match";

describe("message history client matching", () => {
  const clients = [
    { id: 1, name: "송진호", phone: "010-6621-1878" },
    { id: 2, name: "가나다", phone: "010-9641-1878" },
  ];

  it("matches by client id before relying on the current phone number", () => {
    expect(
      matchesMessageHistoryClient(
        { clientId: 2, receiver: "010-0000-0000" },
        clients[1],
      ),
    ).toBe(true);
  });

  it("falls back to normalized phone matching when client id is missing", () => {
    expect(
      matchesMessageHistoryClient(
        { clientId: null, receiver: "+82 10 9641 1878" },
        clients[1],
      ),
    ).toBe(true);
  });

  it("uses the recipient phone snapshot before the provider receiver value", () => {
    expect(
      matchesMessageHistoryClient(
        { clientId: null, receiver: "010-0000-0000", recipientPhone: "010-9641-1878" },
        clients[1],
      ),
    ).toBe(true);
  });

  it("finds the matching client across all customer items", () => {
    expect(findMessageHistoryClient({ clientId: 2, receiver: "010-0000-0000" }, clients)?.name).toBe("가나다");
    expect(findMessageHistoryClient({ clientId: null, receiver: "01066211878" }, clients)?.name).toBe("송진호");
  });
});
