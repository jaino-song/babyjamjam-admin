/**
 * Feature-level entry point for the shared editor. Keeping this import path
 * lets feature tests and consumers use the editor without creating a second
 * implementation beside the app UI component.
 */
export { SystemTemplateEditor } from '@/components/app/ui/SystemTemplateEditor';
export type {
  SystemTemplateEditorDraft,
  SystemTemplateEditorHandle,
  SystemTemplateEditorProps,
  SystemTemplateValidationState,
} from '@/components/app/ui/SystemTemplateEditor';
export {
  hasMalformedVariableSyntax,
  validateSystemTemplateContent,
} from '@/components/app/ui/SystemTemplateEditor';
