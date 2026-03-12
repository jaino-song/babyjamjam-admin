import { create } from "zustand";
import { DEFAULT_EMPLOYEE_GRADE } from "@/features/employees/grade";

interface EmployeeWizardFormData {
  name: string;
  workArea: string[];
  phone: string;
  grade: string;
  openToNextWork: boolean;
}

interface EmployeeWizardStore extends EmployeeWizardFormData {
  currentStep: number;
  setField: <K extends keyof EmployeeWizardFormData>(
    key: K,
    value: EmployeeWizardFormData[K]
  ) => void;
  setCurrentStep: (step: number) => void;
  reset: () => void;
}

const INITIAL_FORM: EmployeeWizardFormData = {
  name: "",
  workArea: [],
  phone: "",
  grade: DEFAULT_EMPLOYEE_GRADE,
  openToNextWork: true,
};

export const useEmployeeWizardStore = create<EmployeeWizardStore>((set) => ({
  ...INITIAL_FORM,
  currentStep: 0,
  setField: (key, value) => set({ [key]: value }),
  setCurrentStep: (step) => set({ currentStep: step }),
  reset: () => set({ ...INITIAL_FORM, currentStep: 0 }),
}));
