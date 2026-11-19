import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { Autocomplete } from './Autocomplete';

it.each<[ReactNode, string]>([
  [<span key="jsx">산모</span>, '선택 항목'],
  ['산모', '산모'],
  [0, '0'],
  [7, '7'],
  ['', '선택 항목'],
  [undefined, '선택 항목'],
])('uses a readable loading name for label %p', (label, expected) => {
  render(<Autocomplete<{ id: number; name: string }>
    name="client"
    data-component="mobile_clients_search_autocomplete"
    label={label}
    value={null}
    onChange={jest.fn()}
    items={[]}
    getItemKey={(item) => item.id}
    getItemLabel={(item) => item.name}
    isLoading
  />);
  const status = screen.getByRole('status', { name: `${expected} 목록을 불러오는 중` });
  expect(status).toHaveAttribute('data-slot', 'loading-state');
  expect(status.querySelector('.sr-only')).toHaveTextContent(`${expected} 목록을 불러오는 중`);
  fireEvent.focus(screen.getByRole('textbox'));
  const statuses = screen.getAllByRole('status', { name: `${expected} 목록을 불러오는 중` });
  expect(statuses).toHaveLength(2);
  for (const loading of statuses) {
    expect(loading).toHaveAttribute('data-slot', 'loading-state');
    expect(loading.querySelector('.sr-only')).toHaveTextContent(`${expected} 목록을 불러오는 중`);
  }
  expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
});
