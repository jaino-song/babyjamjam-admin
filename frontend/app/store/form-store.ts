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
}

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
        setName: (name: string) => set({ name: name}),
        setPhone: (phone: string) => set({ phone: phone}),
        setStartDate: (startDate: string) => set({ startDate: startDate}),
        setEndDate: (endDate: string) => set({ endDate: endDate}),
        setEmployeeName: (employeeName: string) => set({ employeeName: employeeName}),
        setEmployeePhone: (employeePhone: string) => set({ employeePhone: employeePhone}),
        setFullPrice: (fullPrice: string) => set({ fullPrice: fullPrice}),
        setGrant: (grant: string) => set({ grant: grant}),
        setActualPrice: (actualPrice: string) => set({ actualPrice: actualPrice}),
        setPaymentDate: (paymentDate: string) => set({ paymentDate: paymentDate}),
        setVoucherType: (voucherType: string) => set({ voucherType: voucherType}),
        setVoucherDuration: (voucherDuration: string) => set({ voucherDuration: voucherDuration}),
    }
})