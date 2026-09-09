/**
 * Feature-level entry point for the shared editor. Keeping this import path
 * lets feature tests and consumers use the editor without creating a second
 * implementation beside the app UI component.
 */
export { SystemTemplateEditor } from '@/components/app/ui/SystemTemplateEditor';
export type { SystemTemplateEditorProps } from '@/components/app/ui/SystemTemplateEditor';
