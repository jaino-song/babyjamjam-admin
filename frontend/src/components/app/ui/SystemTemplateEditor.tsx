'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  TemplateContentEditor,
  type TemplateContentEditorHandle,
} from '@/components/app/my-templates/template-content-editor';
import { VariableInserter } from '@/components/app/my-templates/variable-inserter';
import {
  useUpdateSystemTemplate,
  type SystemTemplateScope,
} from '@/features/system-templates/hooks';
import type {
  CustomVariable,
  SystemTemplate,
  TemplateVariable as RegistryTemplateVariable,
} from '@/features/system-templates/types';
import { getActiveBranchId } from '@/features/system-templates/branch-context';
import { extractVariables } from '@/lib/template/variable-parser';
import type { TemplateVariable } from '@/lib/template/types';
import { MAX_BODY_LENGTH } from '@/lib/message/byte-length';
import { getApiErrorMessage } from '@babyjamjam/shared';

const CONTENT_PLACEHOLDER =
  '템플릿 내용을 입력하세요. 변수는 {{변수명}} 형식으로 사용합니다.';
const EMPTY_CUSTOM_VARIABLES: CustomVariable[] = [];

export interface SystemTemplateEditorDraft {
  content: string;
  customVariables: CustomVariable[];
  isDirty: boolean;
  isValid: boolean;
  missingVariables: string[];
  unknownVariables: string[];
  hasMalformedVariables: boolean;
}

export interface SystemTemplateEditorHandle {
  save: () => Promise<boolean>;
  reset: (next?: { content?: string; customVariables?: CustomVariable[] }) => void;
  getDraft: () => SystemTemplateEditorDraft;
}

export interface SystemTemplateEditorProps {
  template: SystemTemplate;
  onPreviewMessageChange?: (message: string) => void;
  /** Global defaults are the backwards-compatible editor mode. */
  scope?: SystemTemplateScope;
  /** Captured branch identity used to partition drafts and guard the save. */
  branchId?: string | null;
  onPendingChange?: (pending: boolean) => void;
  /** Caller-owned path used to keep the editor in the surrounding component tree. */
  dataComponent?: string;
  /** Lets a surrounding detail panel own its footer actions. */
  showSaveButton?: boolean;
  /** Receives the current draft so preview tabs can follow unsaved text. */
  onDraftChange?: (draft: SystemTemplateEditorDraft) => void;
  /** Optional validation/status content rendered below the shared editor. */
  validationSlot?: ReactNode;
}

interface EditorBaseline {
  templateKey: string;
  scope: SystemTemplateScope;
  branchId: string | null;
  content: string;
  customVariablesJson: string;
}

export interface SystemTemplateValidationState {
  missingVariables: string[];
  unknownVariables: string[];
  hasMalformedVariables: boolean;
  isOverBodyLimit: boolean;
  isEmpty: boolean;
}

function getCustomVariables(template: SystemTemplate): CustomVariable[] {
  return template.customVariables ?? EMPTY_CUSTOM_VARIABLES;
}

function getCustomVariablesJson(customVariables: CustomVariable[]) {
  return JSON.stringify(customVariables);
}

function toEditorVariable(
  variable: RegistryTemplateVariable | CustomVariable,
): TemplateVariable {
  return {
    key: variable.key,
    label: variable.label,
    type: 'text',
    required: Boolean(variable.required),
  };
}

function buildEditorVariables(
  requiredVariables: RegistryTemplateVariable[] | undefined,
  customVariables: CustomVariable[],
): TemplateVariable[] {
  const seen = new Set<string>();
  return [...(requiredVariables ?? []), ...customVariables].flatMap((variable) => {
    if (!variable?.key || seen.has(variable.key)) return [];
    seen.add(variable.key);
    return [toEditorVariable(variable)];
  });
}

/** Detects unclosed or otherwise unmatched `{{`/`}}` runs. */
export function hasMalformedVariableSyntax(content: string): boolean {
  const closedTokensRemoved = content.replace(/\{\{[^{}]*\}\}/g, '');
  return /\{\{|\}\}/.test(closedTokensRemoved);
}

export function validateSystemTemplateContent(
  content: string,
  variables: TemplateVariable[],
  requiredVariables: TemplateVariable[] = variables,
): SystemTemplateValidationState {
  const availableKeys = new Set(variables.map((variable) => variable.key));
  const detectedKeys = extractVariables(content);
  const unknownVariables = detectedKeys.filter((key) => !availableKeys.has(key));
  const missingVariables = requiredVariables
    .filter((variable) => variable.required && !detectedKeys.includes(variable.key))
    .map((variable) => variable.key);

  return {
    missingVariables,
    unknownVariables,
    hasMalformedVariables: hasMalformedVariableSyntax(content),
    isOverBodyLimit: content.length > MAX_BODY_LENGTH,
    isEmpty: content.trim().length === 0,
  };
}

function getDraftDirty(
  content: string,
  customVariables: CustomVariable[],
  baseline: EditorBaseline,
) {
  return (
    content !== baseline.content ||
    getCustomVariablesJson(customVariables) !== baseline.customVariablesJson
  );
}

export const SystemTemplateEditor = forwardRef<
  SystemTemplateEditorHandle,
  SystemTemplateEditorProps
>(function SystemTemplateEditor(
  {
    template,
    onPreviewMessageChange,
    scope = 'global',
    branchId = null,
    onPendingChange,
    dataComponent = 'desktop_system-templates_editor',
    showSaveButton = true,
    onDraftChange,
    validationSlot,
  },
  ref,
) {
  const { content: templateContent, templateKey } = template;
  const incomingCustomVariables = getCustomVariables(template);
  const incomingCustomVariablesJson = getCustomVariablesJson(incomingCustomVariables);
  // Query mocks and server adapters may omit customVariables. Keying this
  // snapshot by the serialized value keeps the fallback array stable and
  // prevents the sync effect from retriggering on every render. This also
  // tolerates adapters that recreate an equivalent array on each render.
  const customVariablesSnapshotRef = useRef({
    json: incomingCustomVariablesJson,
    value: incomingCustomVariables,
  });
  if (customVariablesSnapshotRef.current.json !== incomingCustomVariablesJson) {
    customVariablesSnapshotRef.current = {
      json: incomingCustomVariablesJson,
      value: incomingCustomVariables,
    };
  }
  const templateCustomVariables = customVariablesSnapshotRef.current.value;
  const templateCustomVariablesJson = incomingCustomVariablesJson;
  const editorVariables = useMemo(
    () => buildEditorVariables(template.requiredVariables, templateCustomVariables),
    [template.requiredVariables, templateCustomVariables],
  );
  const registryVariables = useMemo(
    () => (template.requiredVariables ?? []).map(toEditorVariable),
    [template.requiredVariables],
  );
  const quickInsertVariables = useMemo(
    () =>
      editorVariables.map((variable) => {
        const isCustom = templateCustomVariables.some((candidate) => candidate.key === variable.key);
        return {
          key: variable.key,
          label: `${variable.required ? '* ' : ''}${variable.label}${isCustom ? ' · 커스텀' : ''}`,
        };
      }),
    [editorVariables, templateCustomVariables],
  );
  const [content, setContent] = useState(templateContent);
  const [customVariables, setCustomVariables] = useState<CustomVariable[]>(
    templateCustomVariables,
  );
  const [baselineVersion, setBaselineVersion] = useState(0);
  const contentRef = useRef(content);
  const customVariablesRef = useRef(customVariables);
  const previewCallbackRef = useRef(onPreviewMessageChange);
  const baselineRef = useRef<EditorBaseline>({
    templateKey,
    scope,
    branchId,
    content: templateContent,
    customVariablesJson: templateCustomVariablesJson,
  });
  const contentEditorRef = useRef<TemplateContentEditorHandle>(null);
  const { toast } = useToast();

  const updateMutation = useUpdateSystemTemplate();

  useEffect(() => {
    onPendingChange?.(updateMutation.isPending);
  }, [onPendingChange, updateMutation.isPending]);

  useEffect(() => {
    previewCallbackRef.current = onPreviewMessageChange;
  }, [onPreviewMessageChange]);

  useEffect(() => {
    const nextCustomVariables = templateCustomVariables;
    const nextCustomVariablesJson = templateCustomVariablesJson;
    const baseline = baselineRef.current;
    const isSameTemplate =
      baseline.templateKey === templateKey &&
      baseline.scope === scope &&
      baseline.branchId === branchId;
    const contentChanged = baseline.content !== templateContent;
    const contentIsDirty = isSameTemplate && contentRef.current !== baseline.content;
    const customVariablesAreDirty =
      isSameTemplate &&
      getCustomVariablesJson(customVariablesRef.current) !== baseline.customVariablesJson;

    if (!contentIsDirty) {
      contentRef.current = templateContent;
      // The editor mirrors the latest server detail only while its field is pristine.
      setContent(templateContent);
      if (contentChanged || !isSameTemplate) {
        previewCallbackRef.current?.(templateContent);
      }
    }

    if (!customVariablesAreDirty) {
      customVariablesRef.current = nextCustomVariables;
      setCustomVariables(nextCustomVariables);
    }

    baselineRef.current = {
      templateKey,
      scope,
      branchId,
      content: templateContent,
      customVariablesJson: nextCustomVariablesJson,
    };
    setBaselineVersion((version) => version + 1);
  }, [
    branchId,
    scope,
    templateContent,
    templateKey,
    templateCustomVariables,
    templateCustomVariablesJson,
  ]);

  const validation = useMemo(
    () => validateSystemTemplateContent(content, editorVariables, registryVariables),
    [content, editorVariables, registryVariables],
  );
  const hasChanges = getDraftDirty(content, customVariables, baselineRef.current);
  const isValid =
    !validation.isEmpty &&
    !validation.isOverBodyLimit &&
    !validation.hasMalformedVariables &&
    validation.unknownVariables.length === 0 &&
    validation.missingVariables.length === 0;
  const currentDraft: SystemTemplateEditorDraft = {
    content,
    customVariables,
    isDirty: hasChanges,
    isValid,
    missingVariables: validation.missingVariables,
    unknownVariables: validation.unknownVariables,
    hasMalformedVariables: validation.hasMalformedVariables,
  };

  useEffect(() => {
    onDraftChange?.(currentDraft);
    // `baselineVersion` ensures a successful save/reset emits the pristine
    // draft state even when its content string itself did not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    baselineVersion,
    content,
    customVariables,
    hasChanges,
    isValid,
    onDraftChange,
    validation.hasMalformedVariables,
    validation.missingVariables,
    validation.unknownVariables,
  ]);

  const handleContentChange = (nextContent: string) => {
    if (updateMutation.isPending) return;
    contentRef.current = nextContent;
    setContent(nextContent);
    onPreviewMessageChange?.(nextContent);
  };

  const resetDraft = (next?: { content?: string; customVariables?: CustomVariable[] }) => {
    const nextContent = next?.content ?? templateContent;
    const nextCustomVariables = next?.customVariables ?? templateCustomVariables;
    const nextCustomVariablesJson = getCustomVariablesJson(nextCustomVariables);
    contentRef.current = nextContent;
    customVariablesRef.current = nextCustomVariables;
    baselineRef.current = {
      templateKey,
      scope,
      branchId,
      content: nextContent,
      customVariablesJson: nextCustomVariablesJson,
    };
    setContent(nextContent);
    setCustomVariables(nextCustomVariables);
    setBaselineVersion((version) => version + 1);
    previewCallbackRef.current?.(nextContent);
  };

  const handleSave = async (): Promise<boolean> => {
    if (!hasChanges || !isValid || updateMutation.isPending) return false;

    try {
      const baseParams = {
        key: templateKey,
        content,
        customVariables,
      };

      if (scope === 'branch') {
        const capturedBranchId = branchId ?? getActiveBranchId();
        if (!capturedBranchId) {
          throw new Error('지점을 선택한 뒤 템플릿을 저장해 주세요.');
        }

        await updateMutation.mutateAsync({
          ...baseParams,
          scope,
          branchId: capturedBranchId,
        });
      } else {
        await updateMutation.mutateAsync(baseParams);
      }

      // Keep the draft pristine immediately after a successful mutation. The
      // query refetch may arrive later, and must not make the footer look dirty.
      baselineRef.current = {
        templateKey,
        scope,
        branchId,
        content,
        customVariablesJson: getCustomVariablesJson(customVariables),
      };
      contentRef.current = content;
      customVariablesRef.current = customVariables;
      setBaselineVersion((version) => version + 1);
      toast({
        variant: 'success',
        description: '템플릿을 저장했어요',
      });
      return true;
    } catch (error) {
      toast({
        variant: 'destructive',
        description: getApiErrorMessage(
          error,
          error instanceof Error ? error.message : '템플릿을 저장하지 못했어요',
        ),
      });
      return false;
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      save: handleSave,
      reset: resetDraft,
      getDraft: () => currentDraft,
    }),
    // The callbacks intentionally capture the current controlled draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      content,
      customVariables,
      hasChanges,
      isValid,
      templateKey,
      scope,
      branchId,
      baselineVersion,
      updateMutation.isPending,
    ],
  );

  const validationMessages = [
    validation.isEmpty ? '메시지 본문을 입력해 주세요.' : null,
    validation.isOverBodyLimit ? '메시지가 최대 길이(2,000자)를 초과했습니다.' : null,
    validation.hasMalformedVariables
      ? '변수 구문을 확인해 주세요. {{변수명}} 형식으로 입력해야 합니다.'
      : null,
    validation.unknownVariables.length > 0
      ? `등록되지 않은 변수: ${validation.unknownVariables.join(', ')}`
      : null,
    validation.missingVariables.length > 0
      ? `필수 변수를 모두 넣어 주세요: ${validation.missingVariables.join(', ')}`
      : null,
  ].filter((message): message is string => Boolean(message));

  const validationHint = validationSlot ?? (
    validationMessages.length > 0 ? (
      <div
        data-component={`${dataComponent}_validation`}
        role="alert"
        className="flex flex-col gap-1 text-sm text-destructive"
      >
        {validationMessages.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </div>
    ) : null
  );

  return (
    <div
      data-component={dataComponent}
      data-source-component="SystemTemplateEditor"
      className="flex flex-col gap-6"
    >
      <TemplateContentEditor
        ref={contentEditorRef}
        id={`${dataComponent}_content-input`}
        dataComponent={dataComponent}
        label="템플릿 내용"
        disabled={updateMutation.isPending}
        quickInsert={
          <VariableInserter
            dataComponent={`${dataComponent}_quick-insert`}
            variables={quickInsertVariables}
            allowCustom={false}
            disabled={updateMutation.isPending}
            onInsert={(key) => contentEditorRef.current?.insertVariable(key)}
          />
        }
        content={content}
        onContentChange={handleContentChange}
        variables={editorVariables}
        placeholder={CONTENT_PLACEHOLDER}
        hint={validationHint}
      />

      {scope === 'branch' ? (
        <p
          data-component={`${dataComponent}_branch-freeze-note`}
          className="text-sm text-v3-text-muted"
          role="note"
        >
          이 템플릿을 처음 저장하면 지점의 모든 템플릿이 현재 기본값으로 고정됩니다. 이후 오너가 기본값을 바꿔도 이 지점에는 자동으로 적용되지 않습니다.
        </p>
      ) : null}

      {showSaveButton ? (
        <div className="flex gap-2 justify-end">
          <Button
            data-component={`${dataComponent}_save-button`}
            onClick={() => void handleSave()}
            disabled={!hasChanges || !isValid || updateMutation.isPending}
          >
            {updateMutation.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            {updateMutation.isPending ? '저장 중...' : '저장'}
          </Button>
        </div>
      ) : null}
    </div>
  );
});

SystemTemplateEditor.displayName = 'SystemTemplateEditor';
