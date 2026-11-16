import { fireEvent, render, screen } from "@testing-library/react";

import { MessageSenderApprovalModal } from "../MessageSenderApprovalModal";

it("puts outline cancel before request with one-third and two-thirds widths", () => {
  const onCancel = jest.fn();
  const onRequest = jest.fn();
  render(<MessageSenderApprovalModal open needsRequestPermission={false} onOpenChange={jest.fn()} onCancel={onCancel} onRequest={onRequest} />);
  const cancel = screen.getByRole("button", { name: "취소" });
  const request = screen.getByRole("button", { name: "신청하기" });
  expect(screen.getAllByRole("button")).toEqual([cancel, request]);
  expect(cancel).toHaveClass("flex-1", "border");
  expect(request).toHaveClass("flex-[2]");
  fireEvent.click(cancel);
  fireEvent.click(request);
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onRequest).toHaveBeenCalledTimes(1);
});

it.each([{ isApprovalPending: true, needsRequestPermission: false }, { needsRequestPermission: true }])("keeps the single confirmation action full width (%o)", (props) => {
  render(<MessageSenderApprovalModal open {...props} onOpenChange={jest.fn()} onCancel={jest.fn()} onRequest={jest.fn()} />);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "확인" })).toHaveClass("flex-1");
});
