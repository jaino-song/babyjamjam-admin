"use client";

import { ContentPaper } from "@/components/app/root/content-paper";
import { TemplateEditor } from "@/components/app/my-templates/template-editor";
import { MessagesSectionChrome } from "@/components/app/messages/MessagesSectionChrome";
import { useMessageHistoryListState } from "@/components/app/messages/useMessageHistoryListState";
import { useMessageSections } from "@/components/app/messages/useMessageSections";
import { useMessageTemplates } from "@/features/message-templates/hooks/use-message-templates";
import { useScrollActivity } from "@/components/app/v3/useScrollActivity";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";

export default function NewTemplatePage() {
    const locale = useLocale();
    const historyState = useMessageHistoryListState();
    const sections = useMessageSections();
    const templates = useMessageTemplates(1, 100);
    const { isScrollActive, handleScroll } = useScrollActivity();

    return (
        <MessagesSectionChrome
            data-component="desktop_messages_sections_templates-new"
            historyState={historyState}
            sections={sections}
            activeId="template-create"
            branchTemplates={{
                count: templates.data?.length ?? (templates.isError ? "—" : 0),
                isLoading: templates.isLoading || (templates.isPaused && templates.data === undefined),
            }}
        >
            <div
                data-component="desktop_messages_sections_templates-new_templates-new-content"
                className="scrollbar-on-scroll flex-1 min-h-0 min-w-0 overflow-y-auto"
                data-scroll-active={isScrollActive ? "true" : "false"}
                onScroll={handleScroll}
            >
                <ContentPaper
                    title={t(locale, "template-editor.create-title")}
                    subtitle={t(locale, "template-editor.create-subtitle")}
                    className="min-h-[70vh]"
                >
                    <TemplateEditor />
                </ContentPaper>
            </div>
        </MessagesSectionChrome>
    );
}
