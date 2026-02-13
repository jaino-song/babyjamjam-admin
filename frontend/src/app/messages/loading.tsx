"use client";

import { Spinner } from "@/components/ui/spinner";
import { ContentPaper } from "@/components/app/root/content-paper";

export default function Loading() {
    return (
        <ContentPaper className="rounded-t-none flex-grow flex flex-col justify-center items-center w-full h-full">
            <Spinner size="lg" className="text-primary" />
        </ContentPaper>
    );
}
