"use client";

import { createContext, useContext } from "react";
import { Locale } from "@/app/actions/locale";

const LocaleContext = createContext<Locale>("ko");

interface LocaleProviderProps {
    locale: Locale;
    children: React.ReactNode;
}

export function LocaleProvider({ locale, children }: LocaleProviderProps) {
    return (
        <LocaleContext.Provider value={locale}>
            {children}
        </LocaleContext.Provider>
    );
}

export function useLocale() {
    return useContext(LocaleContext);
}

