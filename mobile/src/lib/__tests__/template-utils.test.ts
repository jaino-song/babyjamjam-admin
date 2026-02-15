import { extractVariables, renderTemplate } from '../template-utils';

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

    it('should convert non-string values to string (numbers)', () => {
      expect(renderTemplate('Count: {{count}}', { count: 3 })).toBe('Count: 3');
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
});
