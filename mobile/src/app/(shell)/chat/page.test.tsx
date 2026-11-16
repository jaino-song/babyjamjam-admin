import { redirect } from "next/navigation";
import ChatPage from "./page";

jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("NEXT_REDIRECT"); }) }));

it("redirects old chat bookmarks to /agent", () => {
  expect(() => ChatPage()).toThrow("NEXT_REDIRECT");
  expect(redirect).toHaveBeenCalledWith("/agent");
});
