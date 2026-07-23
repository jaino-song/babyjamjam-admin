import { redirect } from "next/navigation";

import MessagesPage from "../page";

jest.mock("next/navigation", () => ({
  redirect: jest.fn(),
}));

describe("MessagesPage", () => {
  it("opens the message send section", () => {
    MessagesPage();

    expect(redirect).toHaveBeenCalledWith("/messages/new");
  });
});
