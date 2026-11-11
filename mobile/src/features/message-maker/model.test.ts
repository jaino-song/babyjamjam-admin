import { buildMakerOptions, mergeMakerVariables, renderMakerBody } from './model';
import type { SystemTemplate } from '@/features/system-templates/types';

const template = (key: string, content: string, group = 'provider') => ({
  templateKey: key, content, name: key, group, groupLabel: '제공인력 대상',
  requiredVariables: [], customVariables: [],
}) as unknown as SystemTemplate;

describe('message maker catalog', () => {
  it('preserves every authoritative entry, order, group and empty body with namespaced values', () => {
    const options = buildMakerOptions([template('CAREGIVER_SERVICE_START_NOTICE', ''), template('PRICE_INFO', '{{name}}')], [{ id: 'PRICE_INFO', name: '개인 양식', content: '개인', variables: [], createdAt: '', updatedAt: '' }]);
    expect(options.map(option => option.value)).toEqual(['system:CAREGIVER_SERVICE_START_NOTICE', 'system:PRICE_INFO', 'user:PRICE_INFO', 'custom']);
    expect(options[0]).toMatchObject({ content: '', group: 'system:provider', groupLabel: '제공인력 대상' });
  });
  it('merges custom metadata and placeholders without requiring unused registry fields', () => {
    expect(mergeMakerVariables('{{ name }} {{extra}} {{raw}}', [
      { key: 'name', label: '이름', required: true }, { key: 'unused', label: '미사용', required: true },
    ], [{ key: 'extra', label: '추가 정보', required: false }, { key: 'name', label: '담당 이름', required: false }])).toEqual([
      { key: 'name', label: '담당 이름', required: false }, { key: 'extra', label: '추가 정보', required: false }, { key: 'raw', label: 'raw', required: false },
    ]);
  });
  it('preserves missing placeholders and renders provided values as plain text', () => {
    expect(renderMakerBody('{{name}} {{link}}', { name: '<b>QA</b>', link: '' })).toBe('<b>QA</b> {{link}}');
  });
  it('offers custom composition with an empty server catalog', () => {
    expect(buildMakerOptions([], []).map(option => option.value)).toEqual(['custom']);
  });
});
