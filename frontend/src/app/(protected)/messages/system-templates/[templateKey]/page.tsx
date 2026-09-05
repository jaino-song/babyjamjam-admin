import { redirect } from 'next/navigation';

import { SYSTEM_TEMPLATE_KEYS } from '@/features/system-templates/types';

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

  if ((SYSTEM_TEMPLATE_KEYS as readonly string[]).includes(templateKey)) {
    redirect(`/system-admin?section=templates&template=${templateKey}`);
  }

  redirect('/system-admin?section=templates');
}
