/**
 * The dialog's X may leave only while the form reports it is detachable (awaiting
 * the first dispatch / enqueue call; the server finishes the send regardless), and
 * never for a re-issue. Everywhere else the X follows the busy rule. ESC and
 * outside-click stay blocked whenever the dialog is busy.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import type { Client } from "@/features/clients/types";
import { MaternityContractDialog } from "../MaternityContractDialog";

interface StubFormProps {
  onSessionStateChange?: (hasSession: boolean) => void;
  onSubmissionStateChange?: (submitting: boolean) => void;
  onProcessingFailureChange?: (failed: boolean) => void;
  onDetachableChange?: (detachable: boolean) => void;
  renderLayout?: (parts: { content: ReactNode; footer: ReactNode }) => ReactNode;
}

let formProps: StubFormProps = {};

jest.mock("@/components/app/contracts/ContractCreationForm", () => ({
  CONTRACT_CREATION_STEPPER_STEPS: [{ label: "이용자 정보" }],
  ContractCreationForm: (props: StubFormProps) => {
    formProps = props;
    return props.renderLayout?.({ content: <div>form-content</div>, footer: null }) ?? null;
  },
}));

jest.mock("@/components/app/v3/SteppedWizardStepper", () => ({
  SteppedWizardStepper: () => null,
}));

const client = { id: 7, name: "송진호" } as unknown as Client;

function renderDialog(supersedeDocumentId?: string) {
  const onClose = jest.fn();
  render(
    <MaternityContractDialog
      open
      onClose={onClose}
      client={client}
      supersedeDocumentId={supersedeDocumentId}
    />,
  );
  return { onClose };
}

const closeButton = () =>
  document.querySelector<HTMLButtonElement>(
    '[data-component="desktop_clients_maternity-contract-dialog_close"]',
  ) as HTMLButtonElement;

describe("MaternityContractDialog — closing while busy", () => {
  beforeEach(() => {
    formProps = {};
  });

  it("closes from the X while the form is detachable", () => {
    const { onClose } = renderDialog();
    act(() => {
      formProps.onSubmissionStateChange?.(true);
      formProps.onSessionStateChange?.(true);
      formProps.onDetachableChange?.(true);
    });

    expect(closeButton()).toBeEnabled();
    fireEvent.click(closeButton());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the X disabled during a session once the form is no longer detachable", () => {
    const { onClose } = renderDialog();
    act(() => {
      formProps.onSubmissionStateChange?.(true);
      formProps.onSessionStateChange?.(true);
      formProps.onDetachableChange?.(true);
    });
    act(() => {
      formProps.onDetachableChange?.(false);
    });

    expect(closeButton()).toBeDisabled();
    fireEvent.click(closeButton());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the X disabled for a re-issue even while detachable", () => {
    const { onClose } = renderDialog("doc-old-1");
    act(() => {
      formProps.onSubmissionStateChange?.(true);
      formProps.onSessionStateChange?.(true);
      formProps.onDetachableChange?.(true);
    });

    expect(closeButton()).toBeDisabled();
    fireEvent.click(closeButton());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the X disabled while submitting before the form is detachable", () => {
    const { onClose } = renderDialog();
    act(() => {
      formProps.onSubmissionStateChange?.(true);
    });

    expect(closeButton()).toBeDisabled();
    fireEvent.click(closeButton());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("blocks ESC while detachable and busy", () => {
    const { onClose } = renderDialog();
    act(() => {
      formProps.onSubmissionStateChange?.(true);
      formProps.onSessionStateChange?.(true);
      formProps.onDetachableChange?.(true);
    });

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("form-content")).toBeInTheDocument();
  });

  it("closes on ESC when nothing is running", () => {
    const { onClose } = renderDialog();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
