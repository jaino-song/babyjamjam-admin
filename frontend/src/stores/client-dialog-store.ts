import { create } from "zustand";
import type { Client, CreateClientDto } from "@/lib/client/types";

export type ClientDialogDraftData = Omit<CreateClientDto, "primaryEmployeeId"> & {
    primaryEmployeeId: number | null;
};

export interface ClientDialogDraft {
    formData: ClientDialogDraftData;
    pricesManuallyEdited: boolean;
    client: Client | null;
}

interface ClientDialogStore {
    prefillName: string;
    setPrefillName: (name: string) => void;
    clearPrefillName: () => void;
    draft: ClientDialogDraft | null;
    setDraft: (draft: ClientDialogDraft) => void;
    clearDraft: () => void;
}

export const useClientDialogStore = create<ClientDialogStore>((set) => ({
    prefillName: "",
    draft: null,
    setPrefillName: (name) => set({ prefillName: name }),
    clearPrefillName: () => set({ prefillName: "" }),
    setDraft: (draft) => set({ draft }),
    clearDraft: () => set({ draft: null }),
}));
