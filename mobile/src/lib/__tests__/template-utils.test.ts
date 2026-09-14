import type { MessageTemplateVariable } from '@babyjamjam/shared/types/message';
import {
  extractVariables,
  getUnresolvedKeys,
  renderTemplate,
} from '../template/variable-parser';

function makeVariable(key: string, fallback?: string): MessageTemplateVariable {
  return {
    key,
    type: 'text',
    label: key,
    required: false,
    fallback,
  };
}

describe('template-utils', () => {
  describe('renderTemplate', () => {
    it('should substitute all variables with data values', () => {
      const content = 'Hello {{name}}, total: {{price}}';
      const data = { name: 'Kim', price: '100원' };

      expect(renderTemplate(content, data)).toBe('Hello Kim, total: 100원');
    });

    it('should handle whitespace inside braces {{ name }}', () => {
      expect(renderTemplate('Hello {{ name }}', { name: 'Kim' })).toBe('Hello Kim');
    });

    it('should preserve unmatched variables', () => {
      const content = 'Hello {{name}}, unknown: {{unknown}}';
      const data = { name: 'Kim' };

      expect(renderTemplate(content, data)).toBe('Hello Kim, unknown: {{unknown}}');
    });

    it('should handle empty data object', () => {
      expect(renderTemplate('Hello {{name}}', {})).toBe('Hello {{name}}');
    });

    it('should handle undefined values in data', () => {
      expect(renderTemplate('Hello {{name}}', { name: undefined })).toBe('Hello {{name}}');
    });

    it('should preserve variables when value is an empty string', () => {
      expect(renderTemplate('Hello {{name}}', { name: '' })).toBe('Hello {{name}}');
    });

    it('should preserve variables when value is whitespace only', () => {
      expect(renderTemplate('Hello {{name}}', { name: '   ' })).toBe('Hello {{name}}');
    });

    it('should preserve variables when value is null', () => {
      expect(renderTemplate('Hello {{name}}', { name: null })).toBe('Hello {{name}}');
    });

    it('should convert non-string values to string (numbers)', () => {
      expect(renderTemplate('Count: {{count}}', { count: 3 })).toBe('Count: 3');
    });

    it('should convert false and zero values to strings instead of treating them as empty', () => {
      expect(renderTemplate('{{zero}}/{{enabled}}', { zero: 0, enabled: false })).toBe('0/false');
    });

    it('should use a non-empty fallback after a missing or blank value', () => {
      const variables = [makeVariable('name', '고객님')];

      expect(renderTemplate('Hello {{name}}', {}, variables)).toBe('Hello 고객님');
      expect(renderTemplate('Hello {{name}}', { name: '   ' }, variables)).toBe('Hello 고객님');
    });

    it('should retain the original placeholder when no fallback resolves it', () => {
      expect(renderTemplate('Hello {{ name }}', {})).toBe('Hello {{ name }}');
      expect(renderTemplate('Hello {{name}}', {}, [makeVariable('name', '   ')])).toBe('Hello {{name}}');
    });

    it('should apply the same value, fallback, then placeholder priority to duplicates', () => {
      const variables = [makeVariable('name', '고객님')];

      expect(renderTemplate('{{name}} / {{name}}', { name: '지호' }, variables)).toBe('지호 / 지호');
      expect(renderTemplate('{{name}} / {{name}}', {}, variables)).toBe('고객님 / 고객님');
      expect(renderTemplate('{{name}} / {{name}}', {}, [])).toBe('{{name}} / {{name}}');
    });

    it('should not resolve inherited values from the template data prototype', () => {
      const values = Object.create({ name: '프로토타입 고객' }) as Record<string, unknown>;

      expect(renderTemplate('{{name}}', values)).toBe('{{name}}');
      expect(renderTemplate('{{name}}', values, [makeVariable('name', '고객님')])).toBe('고객님');
    });
  });

  describe('extractVariables', () => {
    it('should extract all variables from content', () => {
      const content = 'Hello {{name}}, total: {{price}} ({{count}})';
      expect(extractVariables(content)).toEqual(['name', 'price', 'count']);
    });

    it('should dedupe duplicate variables', () => {
      expect(extractVariables('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
    });

    it('should handle whitespace', () => {
      expect(extractVariables('{{ a }} {{b }} {{ c}}')).toEqual(['a', 'b', 'c']);
    });

    it('should return empty array for no variables', () => {
      expect(extractVariables('Hello world')).toEqual([]);
    });
  });

  describe('getUnresolvedKeys', () => {
    it('should report only placeholders without values or fallbacks', () => {
      expect(getUnresolvedKeys('{{name}} {{phone}}', { name: '지호' })).toEqual(['phone']);
      expect(getUnresolvedKeys('{{name}} {{phone}}', { name: '지호' }, [
        makeVariable('phone', '010-0000-0000'),
      ])).toEqual([]);
    });
  });
});
