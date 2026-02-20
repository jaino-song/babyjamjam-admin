import { render } from "@react-email/components";
import ResetPasswordEmail from "./reset-password-email";

interface RenderOptions {
  name?: string;
  resetUrl: string;
  expiryHours?: number;
}

export async function renderResetPasswordEmail(options: RenderOptions): Promise<string> {
  return render(ResetPasswordEmail(options));
}
