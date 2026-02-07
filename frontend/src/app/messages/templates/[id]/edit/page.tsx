"use client";

import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TemplateEditor } from "@/app/(components)/my-templates/template-editor";
import { useMessageTemplate } from "@/app/hooks/use-message-templates";
import { ContentPaper } from "@/app/(components)/root/content-paper";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { t } from "@/app/lib/i18n/translations";

export default function EditTemplatePage() {
    const params = useParams();
    const id = params.id as string;
    const locale = useLocale();

    const { data: template, isLoading, error } = useMessageTemplate(id);

    const BackButton = () => (
        <div data-component="messages-template-edit-nav" className="mb-4">
            <Button variant="ghost" size="icon" asChild>
                <Link href="/messages/templates">
                    <ArrowLeft className="h-6 w-6" />
                </Link>
            </Button>
        </div>
    );

    if (isLoading) {
        return (
            <div data-component="messages-template-edit" className="bg-background">
                <div data-component="messages-template-edit-content" className="px-4 sm:px-6 md:px-12 py-6 sm:py-8 mx-auto">
                    <BackButton />
                    <ContentPaper
                        title={t(locale, "template-editor.edit-title")}
                        className="min-h-[70vh] flex justify-center items-center"
                    >
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </ContentPaper>
                </div>
            </div>
        );
    }

    if (error || !template) {
        return (
            <div data-component="messages-template-edit" className="bg-background">
                <div data-component="messages-template-edit-content" className="px-4 sm:px-6 md:px-12 py-6 sm:py-8 mx-auto">
                    <BackButton />
                    <ContentPaper
                        title={t(locale, "template-editor.edit-title")}
                        className="min-h-[70vh]"
                    >
                        <Alert variant="destructive">
                            <AlertDescription>{t(locale, "common.error-loading")}</AlertDescription>
                        </Alert>
                    </ContentPaper>
                </div>
            </div>
        );
    }

    return (
        <div data-component="messages-template-edit" className="bg-background">
            <section data-component="messages-template-edit-content" className="px-4 sm:px-6 md:px-12 py-6 sm:py-8 mx-auto">
                <BackButton />
                <ContentPaper
                    title={t(locale, "template-editor.edit-title")}
                    subtitle={t(locale, "template-editor.edit-subtitle")}
                    className="min-h-[70vh]"
                >
                    <TemplateEditor initialData={template} />
                </ContentPaper>
            </section>
        </div>
    );
}

