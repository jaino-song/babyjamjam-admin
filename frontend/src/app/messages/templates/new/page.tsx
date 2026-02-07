"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ContentPaper } from "@/app/(components)/root/content-paper";
import { TemplateEditor } from "@/app/(components)/my-templates/template-editor";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { t } from "@/app/lib/i18n/translations";

export default function NewTemplatePage() {
    const locale = useLocale();

    return (
        <div data-component="messages-templates-new" className="bg-background">
            <section data-component="messages-templates-new-content" className="px-4 sm:px-6 md:px-12 py-6 sm:py-8 mx-auto">
                <div data-component="messages-templates-new-nav" className="mb-4">
                    <Button variant="ghost" size="icon" asChild>
                        <Link href="/messages/templates">
                            <ArrowLeft className="h-6 w-6" />
                        </Link>
                    </Button>
                </div>
                <ContentPaper
                    title={t(locale, "template-editor.create-title")}
                    subtitle={t(locale, "template-editor.create-subtitle")}
                    className="min-h-[70vh]"
                >
                    <TemplateEditor />
                </ContentPaper>
            </section>
        </div>
    );
}

