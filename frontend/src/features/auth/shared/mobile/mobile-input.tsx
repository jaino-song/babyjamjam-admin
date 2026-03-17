import * as React from "react";

import { Input as BaseInput, type InputProps as BaseInputProps } from "@/components/ui/input";

export type MobileInputProps = Omit<BaseInputProps, "variant">;

export const MobileInput = React.forwardRef<HTMLInputElement, MobileInputProps>((props, ref) => {
  return <BaseInput ref={ref} variant="v3" {...props} />;
});

MobileInput.displayName = "MobileInput";
