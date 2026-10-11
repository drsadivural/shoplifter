// Small shared pieces for group C: 409 conflict state, copy-to-clipboard, store-timezone lookup.
import { useCallback, useState } from 'react';
import type { ApiError } from '../../api/client';
import { useI18n } from '../../i18n';
import { useSession } from '../../session/SessionProvider';
import { Button, StatusPill } from '../primitives';
import { ConflictBanner } from '../states';

export interface ConflictInfo {
  code: string;
  currentVersion: number | null;
}

/** 409 handling: remember the conflict, refetch the current version, never retry automatically. */
export function useConflict(reload: () => void) {
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const onConflict = useCallback(
    (e: ApiError) => {
      if (e.status !== 409) return false;
      setConflict({ code: e.code, currentVersion: e.currentVersion });
      reload();
      return true;
    },
    [reload],
  );
  return { conflict, setConflict, onConflict };
}

const CONFLICT_DETAIL: Record<string, string> = {
  owned_by_another_responder: 'Another responder owns this alert. Only the assignee can record its outcome.',
  evidence_pending: 'Evidence is still uploading. Wait for it to arrive, or record the outcome as inconclusive.',
  invalid_transition: 'This action is not possible in the record’s current state.',
  case_closed: 'This case is closed. Reopen it to change linked incidents.',
  not_a_watchlist_candidate: 'Only watchlist candidates have an identity association.',
  no_legal_hold: 'This incident has no legal hold.',
  idempotency_mismatch: 'This request key was already used for a different export. Submit the form again.',
};

export function ConflictNotice({
  conflict,
  currentVersion,
  reloading,
  onReload,
}: {
  conflict: ConflictInfo;
  currentVersion?: number | null;
  reloading?: boolean;
  onReload: () => void;
}) {
  const { t } = useI18n();
  const detail = CONFLICT_DETAIL[conflict.code];
  return (
    <div className="gc-conflict">
      <ConflictBanner currentVersion={currentVersion ?? conflict.currentVersion} reloading={reloading} onReload={onReload} />
      {detail ? <p className="gc-conflict-detail small">{t(detail)}</p> : null}
    </div>
  );
}

/** Copies text; shows "Copied" after success. Text is never logged. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className="gc-copy">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setFailed(false);
          const p = navigator.clipboard?.writeText(text);
          if (!p) {
            setFailed(true);
            return;
          }
          p.then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2500);
            },
            () => setFailed(true),
          );
        }}
      >
        {copied ? t('Copied') : label}
      </Button>
      {failed ? <span className="muted small"> {t('Copy failed — select the text and copy it manually.')}</span> : null}
    </span>
  );
}

/** Timezone for a record's store (falls back to the selected store, then the org). */
export function useStoreTimeZone() {
  const { stores, timeZone } = useSession();
  return useCallback(
    (storeId: string | null | undefined, explicit?: string | null) =>
      explicit ?? (storeId ? stores.find((s) => s.id === storeId)?.timezone : undefined) ?? timeZone,
    [stores, timeZone],
  );
}

export function useStoreName() {
  const { stores } = useSession();
  const { t } = useI18n();
  return useCallback(
    (storeId: string | null | undefined) =>
      storeId ? stores.find((s) => s.id === storeId)?.name ?? t('Store outside your access') : t('All stores'),
    [stores, t],
  );
}

export function CaseStatusPill({ status }: { status: 'open' | 'closed' }) {
  const { t } = useI18n();
  return status === 'open' ? <StatusPill tone="info">{t('case|Open')}</StatusPill> : <StatusPill tone="neutral">{t('case|Closed')}</StatusPill>;
}
