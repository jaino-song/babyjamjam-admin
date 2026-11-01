import { create } from "zustand";
import { DEFAULT_EMPLOYEE_GRADE } from "@/features/employees/grade";
import type { CreateEmployeeDto } from "@/hooks/useEmployees";
import { normalizeKoreanPhoneDigits } from "@/lib/phone";

interface EmployeeWizardFormData {
  name: string;
  workArea: string[];
  phone: string;
  grade: string;
  openToNextWork: boolean;
  smsAutomationEnabled: boolean;
}

interface EmployeeWizardStore extends EmployeeWizardFormData {
  currentStep: number;
  setField: <K extends keyof EmployeeWizardFormData>(
    key: K,
    value: EmployeeWizardFormData[K]
  ) => void;
  setCurrentStep: (step: number) => void;
  reset: () => void;
  getCreateDto: () => CreateEmployeeDto;
}

const INITIAL_FORM: EmployeeWizardFormData = {
  name: "",
  workArea: [],
  phone: "",
  grade: DEFAULT_EMPLOYEE_GRADE,
  openToNextWork: true,
  smsAutomationEnabled: true,
};

export const useEmployeeWizardStore = create<EmployeeWizardStore>((set, get) => ({
  ...INITIAL_FORM,
  currentStep: 0,
  setField: (key, value) => set({ [key]: value }),
  setCurrentStep: (step) => set({ currentStep: step }),
  reset: () => set({ ...INITIAL_FORM, currentStep: 0 }),
  getCreateDto: () => {
    const form = get();
    return {
      name: form.name.trim(),
      workArea: [...form.workArea],
      phone: normalizeKoreanPhoneDigits(form.phone),
      grade: form.grade,
      openToNextWork: form.openToNextWork,
      smsAutomationEnabled: form.smsAutomationEnabled,
    };
  },
}));
