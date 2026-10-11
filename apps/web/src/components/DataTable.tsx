// Server-paginated table. Cursor pagination via "Load more" (next_cursor), optional server sort,
// toolbar slot for filters, empty-state slot, and card mode under 768px (or mode="cards").
import { type ReactNode } from 'react';
import { Link } from 'react-router';
import type { ApiError } from '../api/client';
import type { PagedResult } from '../api/hooks';
import { BREAKPOINTS, useMediaQuery } from '../hooks/useMediaQuery';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import { Button } from './primitives';
import { QueryErrorView } from './RouteStateBoundary';
import { EmptyState, ErrorState, LoadingState } from './states';

export interface Column<T> {
  key: string;
  /** Translated header text. */
  header: string;
  render: (row: T) => ReactNode;
  /** Server-side sortable: clicking the header calls onSortChange. */
  sortable?: boolean;
  align?: 'start' | 'end';
  width?: string;
  /** Card mode: render as the card title (first primary column). */
  primary?: boolean;
  /** Card mode: omit this column. */
  hideInCards?: boolean;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Accessible table caption (visually hidden). */
  caption: string;
  /** Pass a usePagedQuery() result, or the explicit props below. */
  query?: PagedResult<T>;
  rows?: T[];
  loading?: boolean;
  error?: ApiError;
  onRetry?: () => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  loadMoreError?: ApiError;
  /** Rendered when there are no rows (after loading, without error). */
  empty?: ReactNode;
  toolbar?: ReactNode;
  sort?: SortState;
  onSortChange?: (s: SortState) => void;
  /** Makes the primary cell a link and adds a chevron. */
  rowHref?: (row: T) => string;
  /** 'auto' switches to cards under 768px. */
  mode?: 'auto' | 'table' | 'cards';
  /** Optional client-side filter applied to loaded rows (when the API lacks a filter). */
  filterRows?: (row: T) => boolean;
}

export function DataTable<T>(props: DataTableProps<T>) {
  const { t } = useI18n();
  const isMobile = useMediaQuery(BREAKPOINTS.mobile);
  const q = props.query;
  const allRows = props.rows ?? q?.items ?? [];
  const rows = props.filterRows ? allRows.filter(props.filterRows) : allRows;
  const loading = props.loading ?? q?.loading ?? false;
  const error = props.error ?? q?.error;
  const onRetry = props.onRetry ?? q?.reload;
  const hasMore = props.hasMore ?? q?.hasMore ?? false;
  const onLoadMore = props.onLoadMore ?? q?.loadMore;
  const loadingMore = props.loadingMore ?? q?.loadingMore ?? false;
  const loadMoreError = props.loadMoreError ?? q?.loadMoreError;
  const mode = props.mode === 'auto' || !props.mode ? (isMobile ? 'cards' : 'table') : props.mode;
  const { columns, rowKey, rowHref } = props;
  const primary = columns.find((c) => c.primary) ?? columns[0];

  let body: ReactNode;
  if (loading && rows.length === 0) {
    body = <LoadingState variant={mode === 'cards' ? 'cards' : 'table'} rows={5} />;
  } else if (error && rows.length === 0) {
    body = <QueryErrorView error={error} onRetry={onRetry} />;
  } else if (rows.length === 0) {
    body = props.empty ?? <EmptyState title={t('No records match these filters')} compact />;
  } else if (mode === 'cards') {
    body = (
      <ul className="dt-cards" aria-label={props.caption} data-testid="datatable-cards">
        {rows.map((row) => {
          const href = rowHref?.(row);
          return (
            <li className="dt-card" key={rowKey(row)}>
              <div className="dt-card-title">
                {href && primary ? (
                  <Link to={href} className="dt-link">
                    {primary.render(row)}
                  </Link>
                ) : (
                  primary?.render(row)
                )}
              </div>
              <dl className="dt-card-fields">
                {columns
                  .filter((c) => c !== primary && !c.hideInCards)
                  .map((c) => (
                    <div className="dt-card-field" key={c.key}>
                      <dt>{c.header}</dt>
                      <dd>{c.render(row)}</dd>
                    </div>
                  ))}
              </dl>
            </li>
          );
        })}
      </ul>
    );
  } else {
    body = (
      <div className="dt-scroll">
        <table className="dt" data-testid="datatable-table">
          <caption className="visually-hidden">{props.caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => {
                const sorted = props.sort?.key === c.key ? props.sort.dir : undefined;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    style={c.width ? { width: c.width } : undefined}
                    className={c.align === 'end' ? 'align-end' : undefined}
                    aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : c.sortable ? 'none' : undefined}
                  >
                    {c.sortable && props.onSortChange ? (
                      <button
                        type="button"
                        className="th-sort"
                        onClick={() => props.onSortChange?.({ key: c.key, dir: sorted === 'asc' ? 'desc' : 'asc' })}
                      >
                        {c.header}
                        <span aria-hidden="true">{sorted === 'asc' ? ' ↑' : sorted === 'desc' ? ' ↓' : ' ↕'}</span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
              {rowHref ? (
                <th scope="col" className="dt-chevron-col">
                  <span className="visually-hidden">{t('Open')}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = rowHref?.(row);
              return (
                <tr key={rowKey(row)}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.align === 'end' ? 'align-end' : undefined}>
                      {href && c === primary ? (
                        <Link to={href} className="dt-link">
                          {c.render(row)}
                        </Link>
                      ) : (
                        c.render(row)
                      )}
                    </td>
                  ))}
                  {href ? (
                    <td className="dt-chevron-col">
                      <Link to={href} tabIndex={-1} aria-hidden="true" className="dt-chevron">
                        <Icon name="chevronRight" />
                      </Link>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="datatable">
      {props.toolbar ? <div className="toolbar">{props.toolbar}</div> : null}
      {error && rows.length > 0 ? <ErrorState error={error} onRetry={onRetry} compact /> : null}
      {body}
      {rows.length > 0 || hasMore ? (
        <div className="table-foot">
          <span aria-live="polite">{t('Showing {n}', { n: rows.length })}</span>
          {hasMore ? (
            <Button variant="secondary" size="sm" onClick={onLoadMore} pending={loadingMore}>
              {t('Load more')}
            </Button>
          ) : rows.length > 0 ? (
            <span>{t('End of list')}</span>
          ) : null}
        </div>
      ) : null}
      {loadMoreError ? <ErrorState error={loadMoreError} onRetry={onLoadMore} compact /> : null}
    </div>
  );
}
