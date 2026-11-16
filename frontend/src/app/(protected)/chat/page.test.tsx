import { redirect } from "next/navigation";

import ChatRedirectPage from "./page";

jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("NEXT_REDIRECT"); }),
}));

describe("ChatRedirectPage", () => {
  it("redirects the legacy chat route to /agent", () => {
    expect(() => ChatRedirectPage()).toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/agent");
  });
});
