// Timeline (audit actions) and notes for incidents and cases.
import { useState, type FormEvent } from 'react';
import { useI18n } from '../../i18n';
import { TextAreaField } from '../forms';
import { Button } from '../primitives';
import { actionLabel } from './labels';
import '../../styles/group-c.css';

export interface TimelineEntry {
  at: string;
  action: string;
  actor: string | null;
  actor_kind?: string;
}

export function ActivityTimeline({ entries, timeZone, empty }: { entries: TimelineEntry[]; timeZone: string; empty?: string }) {
  const { t, fmt } = useI18n();
  if (entries.length === 0) return <p className="muted small">{empty ?? t('No timeline events recorded.')}</p>;
  return (
    <ol className="timeline-list">
      {entries.map((e, i) => (
        <li key={`${e.at}-${e.action}-${i}`}>
          <span className="timeline-dot" aria-hidden="true" />
          <time dateTime={e.at}>{fmt.dateTime(e.at, timeZone, { withZone: true })}</time> · {actionLabel(t, e.action)}
          {e.actor ? <span className="muted"> · {e.actor}</span> : e.actor_kind === 'system' || e.actor_kind === 'edge' ? <span className="muted"> · {t('System')}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export interface NoteEntry {
  id: string;
  author: string;
  body: string;
  created_at: string;
}

/** Notes are separate from the original evidence; adding one never edits the record. */
export function NotesPanel({
  notes,
  timeZone,
  canAdd,
  onAdd,
  pending,
  error,
}: {
  notes: NoteEntry[];
  timeZone: string;
  canAdd: boolean;
  /** Resolve true when saved (the draft is then cleared; kept on failure). */
  onAdd: (body: string) => Promise<boolean>;
  pending: boolean;
  error?: string | null;
}) {
  const { t, fmt } = useI18n();
  const [draft, setDraft] = useState('');
  const [touched, setTouched] = useState(false);
  const empty = draft.trim().length === 0;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (empty || pending) return;
    if (await onAdd(draft.trim())) {
      setDraft('');
      setTouched(false);
    }
  };
  return (
    <div className="gc-notes">
      {notes.length === 0 ? (
        <p className="muted small">{t('No notes yet.')}</p>
      ) : (
        <ul className="gc-note-list">
          {notes.map((n) => (
            <li key={n.id} className="gc-note">
              <div className="gc-note-meta">
                <strong>{n.author}</strong>
                <time className="muted small" dateTime={n.created_at}>
                  {fmt.dateTime(n.created_at, timeZone, { withZone: true })}
                </time>
              </div>
              <p className="gc-note-body">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canAdd ? (
        <form onSubmit={submit} noValidate className="gc-note-form">
          <TextAreaField
            label={t('Add note')}
            hint={t('Notes are kept separately from the original evidence and recorded in the audit log.')}
            rows={3}
            maxLength={4000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            error={touched && empty ? t('Enter the note text.') : error ?? null}
          />
          <Button type="submit" variant="secondary" pending={pending}>
            {t('Add note')}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
