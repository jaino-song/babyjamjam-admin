import { OwnerAdminConsole } from "@/components/app/system-admin/OwnerAdminConsole";

interface SystemAdminPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstSearchParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SystemAdminPage({ searchParams }: SystemAdminPageProps) {
  const params = await searchParams;
  const section = firstSearchParam(params.section);
  const templateKey = firstSearchParam(params.template) ?? null;
  const initialSectionId = section === "templates" ? "templates" : "branches";

  return (
    <OwnerAdminConsole
      key={`${initialSectionId}:${templateKey ?? ""}`}
      initialSectionId={initialSectionId}
      initialTemplateKey={templateKey}
    />
  );
}
