import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installMatchMedia } from '../test/setup';
import { renderWithProviders } from '../test/utils';
import { DataTable, type Column } from './DataTable';
import { EmptyState } from './states';

interface Row {
  id: string;
  name: string;
  store: string;
}
const columns: Column<Row>[] = [
  { key: 'name', header: 'Camera', primary: true, render: (r) => r.name },
  { key: 'store', header: 'Store', render: (r) => r.store },
];
const rows: Row[] = [
  { id: '1', name: 'CAM-01', store: 'Store One' },
  { id: '2', name: 'CAM-02', store: 'Store Two' },
];

describe('DataTable', () => {
  it('renders a table with headers on desktop', () => {
    renderWithProviders(<DataTable caption="Cameras" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByTestId('datatable-table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Camera' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Store Two' })).toBeInTheDocument();
  });

  it('switches to card mode under 768px', () => {
    installMatchMedia((q) => q === '(max-width: 767px)');
    renderWithProviders(<DataTable caption="Cameras" columns={columns} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/web/camera-detail?id=${r.id}`} />);
    expect(screen.queryByTestId('datatable-table')).not.toBeInTheDocument();
    const cards = screen.getByTestId('datatable-cards');
    expect(cards.querySelectorAll('li')).toHaveLength(2);
    // Field labels are kept in card mode; the primary column becomes a link title.
    expect(screen.getAllByText('Store')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'CAM-01' })).toHaveAttribute('href', '/web/camera-detail?id=1');
  });

  it('honours mode="cards" explicitly', () => {
    renderWithProviders(<DataTable caption="Cameras" mode="cards" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByTestId('datatable-cards')).toBeInTheDocument();
  });

  it('renders the empty slot when there are no rows', () => {
    renderWithProviders(
      <DataTable caption="Cameras" columns={columns} rows={[]} rowKey={(r) => r.id} empty={<EmptyState title="No cameras added yet" />} />,
    );
    expect(screen.getByText('No cameras added yet')).toBeInTheDocument();
    expect(screen.queryByTestId('datatable-table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows Load more for a next cursor and calls onLoadMore', () => {
    const onLoadMore = vi.fn();
    renderWithProviders(<DataTable caption="Cameras" columns={columns} rows={rows} rowKey={(r) => r.id} hasMore onLoadMore={onLoadMore} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Showing 2')).toBeInTheDocument();
  });

  it('emits server sort changes from sortable headers', () => {
    const onSortChange = vi.fn();
    renderWithProviders(
      <DataTable
        caption="Cameras"
        columns={[{ ...columns[0]!, sortable: true }, columns[1]!]}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ key: 'name', dir: 'asc' }}
        onSortChange={onSortChange}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /Camera/ })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(screen.getByRole('button', { name: /Camera/ }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'name', dir: 'desc' });
  });
});
