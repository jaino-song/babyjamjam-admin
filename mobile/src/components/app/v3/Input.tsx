import * as React from "react";
import { Input as BaseInput, type InputProps as BaseInputProps } from "@/components/ui/input";

export type InputProps = Omit<BaseInputProps, "variant">;

export const Input = React.forwardRef<HTMLInputElement, InputProps>((props, ref) => {
  return <BaseInput ref={ref} data-component="v3-input" variant="v3" {...props} />;
});

Input.displayName = "Input";
