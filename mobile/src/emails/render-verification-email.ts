import { render } from "@react-email/components";
import VerificationEmail from "./verification-email";

interface RenderOptions {
  name?: string;
  verificationUrl: string;
  expiryHours?: number;
}

export async function renderVerificationEmail(options: RenderOptions): Promise<string> {
  return render(VerificationEmail(options));
}
