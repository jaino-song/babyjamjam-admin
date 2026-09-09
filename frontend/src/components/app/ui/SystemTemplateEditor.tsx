'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Plus, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useUpdateSystemTemplate } from '@/features/system-templates/hooks';
import type { CustomVariable, SystemTemplate } from '@/features/system-templates/types';

export interface SystemTemplateEditorProps {
  template: SystemTemplate;
  onPreviewMessageChange?: (message: string) => void;
}

interface EditorBaseline {
  templateKey: string;
  content: string;
  customVariablesJson: string;
}

function getCustomVariables(template: SystemTemplate) {
  return template.customVariables ?? [];
}

function getCustomVariablesJson(customVariables: CustomVariable[]) {
  return JSON.stringify(customVariables);
}

export function SystemTemplateEditor({
  template,
  onPreviewMessageChange,
}: SystemTemplateEditorProps) {
  const { content: templateContent, templateKey } = template;
  const templateCustomVariables = getCustomVariables(template);
  const templateCustomVariablesJson = getCustomVariablesJson(templateCustomVariables);
  const [content, setContent] = useState(templateContent);
  const [customVariables, setCustomVariables] = useState<CustomVariable[]>(
    templateCustomVariables,
  );
  const [newVariable, setNewVariable] = useState({ key: '', label: '' });
  const contentRef = useRef(content);
  const customVariablesRef = useRef(customVariables);
  const previewCallbackRef = useRef(onPreviewMessageChange);
  const baselineRef = useRef<EditorBaseline>({
    templateKey,
    content: templateContent,
    customVariablesJson: templateCustomVariablesJson,
  });
  const { toast } = useToast();

  const updateMutation = useUpdateSystemTemplate();

  useEffect(() => {
    previewCallbackRef.current = onPreviewMessageChange;
  }, [onPreviewMessageChange]);

  useEffect(() => {
    const nextCustomVariables = templateCustomVariables;
    const nextCustomVariablesJson = templateCustomVariablesJson;
    const baseline = baselineRef.current;
    const isSameTemplate = baseline.templateKey === templateKey;
    const contentChanged = baseline.content !== templateContent;
    const contentIsDirty = isSameTemplate && contentRef.current !== baseline.content;
    const customVariablesAreDirty =
      isSameTemplate &&
      getCustomVariablesJson(customVariablesRef.current) !== baseline.customVariablesJson;

    if (!contentIsDirty) {
      contentRef.current = templateContent;
      // The editor mirrors the latest server detail only while its field is pristine.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      content: templateContent,
      customVariablesJson: nextCustomVariablesJson,
    };
  }, [templateContent, templateKey, templateCustomVariables, templateCustomVariablesJson]);

  const handleContentChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextContent = event.target.value;
    contentRef.current = nextContent;
    setContent(nextContent);
    onPreviewMessageChange?.(nextContent);
  };

  const handleAddCustomVariable = () => {
    if (!newVariable.key.trim() || !newVariable.label.trim()) {
      toast({
        variant: 'destructive',
        description: '변수 키와 레이블을 입력해 주세요',
      });
      return;
    }

    if (customVariables.some((variable) => variable.key === newVariable.key)) {
      toast({
        variant: 'destructive',
        description: '이미 있는 변수 키예요',
      });
      return;
    }

    const nextCustomVariables = [
      ...customVariables,
      {
        key: newVariable.key,
        label: newVariable.label,
        required: true,
      },
    ];
    customVariablesRef.current = nextCustomVariables;
    setCustomVariables(nextCustomVariables);
    setNewVariable({ key: '', label: '' });
  };

  const handleRemoveCustomVariable = (key: string) => {
    const nextCustomVariables = customVariables.filter((variable) => variable.key !== key);
    customVariablesRef.current = nextCustomVariables;
    setCustomVariables(nextCustomVariables);
  };

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        key: templateKey,
        content,
        customVariables,
      });
      toast({
        variant: 'success',
        description: '템플릿을 저장했어요',
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '템플릿을 저장하지 못했어요';
      toast({
        variant: 'destructive',
        description: errorMessage,
      });
    }
  };

  const hasChanges =
    content !== templateContent ||
    JSON.stringify(customVariables) !== JSON.stringify(getCustomVariables(template));

  return (
    <div className="flex flex-col gap-6">
      {template.requiredVariables && template.requiredVariables.length > 0 && (
        <div>
          <Label className="text-sm font-semibold mb-3 block">
            필수 변수
          </Label>
          <div className="flex flex-wrap gap-2">
            {template.requiredVariables.map((variable) => (
              <Badge
                key={variable.key}
                variant="outline"
                className="text-sm"
              >
                <span className="text-destructive mr-1">*</span>
                {`${variable.label} (${variable.key})`}
              </Badge>
            ))}
          </div>
          {template.requiredVariables.some((variable) => variable.description) && (
            <Card className="mt-3 p-3 bg-info/10 border-info/30">
              {template.requiredVariables
                .filter((variable) => variable.description)
                .map((variable) => (
                  <p key={variable.key} className="text-xs mb-1 last:mb-0">
                    <strong>{variable.label}:</strong> {variable.description}
                  </p>
                ))}
            </Card>
          )}
        </div>
      )}

      <div>
        <Label className="text-sm font-semibold mb-3 block">
          템플릿 내용
        </Label>
        <Textarea
          rows={12}
          value={content}
          onChange={handleContentChange}
          placeholder="템플릿 내용을 입력하세요. 변수는 {{변수명}} 형식으로 사용합니다."
          className="font-mono text-sm"
        />
      </div>

      <div>
        <Label className="text-sm font-semibold mb-3 block">
          커스텀 변수
        </Label>

        {customVariables.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {customVariables.map((variable) => (
              <Badge
                key={variable.key}
                variant="secondary"
                className="text-sm gap-1"
              >
                {`${variable.label} (${variable.key})`}
                <button
                  type="button"
                  onClick={() => handleRemoveCustomVariable(variable.key)}
                  className="ml-1 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        <Card className="p-4">
          <div className="flex flex-row gap-2 mb-3">
            <Input
              placeholder="변수 키 (예: user_name)"
              value={newVariable.key}
              onChange={(event) =>
                setNewVariable({ ...newVariable, key: event.target.value })
              }
              className="flex-1"
            />
            <Input
              placeholder="변수 레이블 (예: 사용자 이름)"
              value={newVariable.label}
              onChange={(event) =>
                setNewVariable({ ...newVariable, label: event.target.value })
              }
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={handleAddCustomVariable}
            >
              <Plus className="h-4 w-4 mr-1" />
              추가
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            커스텀 변수를 추가하여 템플릿을 더 유연하게 만들 수 있습니다.
          </p>
        </Card>
      </div>

      <div className="flex gap-2 justify-end">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || updateMutation.isPending}
        >
          {updateMutation.isPending && (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          )}
          {updateMutation.isPending ? '저장 중...' : '저장'}
        </Button>
      </div>
    </div>
  );
}
