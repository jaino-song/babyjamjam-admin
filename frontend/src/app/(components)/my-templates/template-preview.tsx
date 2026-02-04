"use client";

import { TemplateVariable } from "@/lib/template/types";

interface TemplatePreviewProps {
    content: string;
    variables: TemplateVariable[];
}

export const TemplatePreview = ({ content, variables }: TemplatePreviewProps) => {
    const renderPreview = () => {
        let preview = content;
        variables.forEach((v) => {
            const regex = new RegExp(`\\{\\{\\s*${v.key}\\s*\\}\\}`, "g");
            preview = preview.replace(regex, `[${v.label}]`);
        });

        return preview.split("\n").map((line, i) => (
            <span key={i}>
                {line}
                <br />
            </span>
        ));
    };

    return (
        <div className="p-4 bg-card rounded-md border min-h-[100px] whitespace-pre-wrap break-words">
            <p className="font-mono text-sm">
                {renderPreview()}
            </p>
        </div>
    );
};
