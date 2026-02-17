import { create } from "zustand";

interface ClientDialogStore {
    prefillName: string;
    setPrefillName: (name: string) => void;
    clearPrefillName: () => void;
}

export const useClientDialogStore = create<ClientDialogStore>((set) => ({
    prefillName: "",
    setPrefillName: (name) => set({ prefillName: name }),
    clearPrefillName: () => set({ prefillName: "" }),
}));
