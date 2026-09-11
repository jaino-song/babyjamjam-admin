import { redirect } from 'next/navigation';

/**
 * The default templates are edited in the owner admin console. This route only
 * survives so that old links keep working.
 */
export default async function EditSystemTemplatePage({
  params,
}: {
  params: Promise<{ templateKey: string }>;
}) {
  const { templateKey } = await params;

  if (templateKey) {
    redirect(`/system-admin?section=templates&template=${encodeURIComponent(templateKey)}`);
  }

  redirect('/system-admin?section=templates');
}
