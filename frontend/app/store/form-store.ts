import { create } from "zustand";

interface FormStore {
    name: string;
    phone: string;
    startDate: string;
    endDate: string;
    employeeName: string;
    employeePhone: string;
    fullPrice: string;
    grant: string;
    actualPrice: string;
    paymentDate: string;
    voucherType: string;
    voucherDuration: string;
    voucherYear: number;
    area: string;
    setName: (name: string) => void;
    setPhone: (phone: string) => void;
    setStartDate: (startDate: string) => void;
    setEndDate: (endDate: string) => void;
    setEmployeeName: (employeeName: string) => void;
    setEmployeePhone: (employeePhone: string) => void;
    setFullPrice: (fullPrice: string) => void;
    setGrant: (grant: string) => void;
    setActualPrice: (actualPrice: string) => void;
    setPaymentDate: (paymentDate: string) => void;
    setVoucherType: (voucherType: string) => void;
    setVoucherDuration: (voucherDuration: string) => void;
    setVoucherYear: (voucherYear: number) => void;
    setArea: (area: string) => void;
}

// 현재 연도를 기본값으로 사용
const currentYear = new Date().getFullYear();

export const useFormStore = create<FormStore>((set) => {
    return {
        name: "",
        phone: "",
        startDate: "",
        endDate: "",
        employeeName: "",
        employeePhone: "",
        fullPrice: "",
        grant: "",
        actualPrice: "",
        paymentDate: "",
        voucherType: "",
        voucherDuration: "",
        voucherYear: currentYear,
        area: "",
        setName: (name: string) => set({ name }),
        setPhone: (phone: string) => set({ phone: phone}),
        setStartDate: (startDate: string) => set({ startDate: startDate}),
        setEndDate: (endDate: string) => set({ endDate: endDate}),
        setEmployeeName: (employeeName: string) => set({ employeeName: employeeName}),
        setEmployeePhone: (employeePhone: string) => set({ employeePhone: employeePhone}),
        setFullPrice: (fullPrice: string) => set({ fullPrice: fullPrice}),
        setGrant: (grant: string) => set({ grant: grant}),
        setActualPrice: (actualPrice: string) => set({ actualPrice: actualPrice}),
        setPaymentDate: (paymentDate: string) => set({ paymentDate: paymentDate}),
        setVoucherType: (voucherType: string) => set({ voucherType }),
        setVoucherDuration: (voucherDuration: string) => set({ voucherDuration }),
        setVoucherYear: (voucherYear: number) => set({ voucherYear }),
        setArea: (area: string) => set({ area }),
    }
})