import { create } from "zustand";

interface LangStore {
    language: string;
    setLanguage: (language: string) => void;
}

export const useLangStore = create<LangStore>((set) => {
    return {
        language: "ko",
        setLanguage: (language: string) => set({ language: language }),
    }
})