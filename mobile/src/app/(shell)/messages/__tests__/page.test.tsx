import { redirect } from "next/navigation";

import MessagesPage from "../page";

jest.mock("next/navigation", () => ({
  redirect: jest.fn(),
}));

describe("MessagesPage", () => {
  it("opens the message maker section", () => {
    MessagesPage();

    expect(redirect).toHaveBeenCalledWith("/messages/compose");
  });
});
