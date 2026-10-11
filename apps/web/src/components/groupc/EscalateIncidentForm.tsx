// Escalate one incident: POST /v1/incidents/{id}/escalate {expected_version, reason, priority}.
// Used by web-22 (?incident=) and web-24. 409 is reported to the caller (ConflictBanner + reload).
import { useState, type FormEvent } from 'react';
import type { ApiError } from '../../api/client';
import { useMutation } from '../../api/hooks';
import type { IncidentPriority } from '../../api/types';
import { gc, type IncidentDetail } from '../../pages/_groupc-api';
import { useI18n } from '../../i18n';
import { SelectField, TextAreaField } from '../forms';
import { Button } from '../primitives';
import { fieldError, PRIORITIES, PRIORITY_KEY } from './labels';

export function EscalateIncidentForm({
  incident,
  onUpdated,
  onConflict,
  onCancel,
}: {
  incident: IncidentDetail;
  onUpdated: (i: IncidentDetail) => void;
  onConflict: (e: ApiError) => boolean;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [priority, setPriority] = useState<IncidentPriority>(incident.priority === 'normal' ? 'high' : incident.priority);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const m = useMutation(
    () => gc.escalate(incident.id, { expected_version: incident.version, reason: reason.trim(), priority }),
    {
      successMessage: t('Incident escalated'),
      onSuccess: (updated) => {
        setReason('');
        setTouched(false);
        onUpdated(updated);
      },
      onError: (e) => onConflict(e) || e.status === 422,
    },
  );
  const reasonInvalid = reason.trim().length < 3;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (reasonInvalid) return;
    await m.run(undefined);
  };
  return (
    <form onSubmit={submit} noValidate className="gc-form">
      <SelectField
        label={t('Priority')}
        value={priority}
        onChange={(e) => setPriority(e.target.value as IncidentPriority)}
        options={PRIORITIES.map((p) => ({ value: p, label: t(PRIORITY_KEY[p]) }))}
        error={fieldError(t, m.fieldErrors.priority)}
      />
      <TextAreaField
        label={t('Reason')}
        required
        rows={3}
        maxLength={2000}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        hint={t('Recorded in the audit log with your name.')}
        error={touched && reasonInvalid ? t('Enter a reason of at least {n} characters.', { n: 3 }) : fieldError(t, m.fieldErrors.reason)}
      />
      <p className="muted small">
        {t('Escalating notifies the store’s primary and backup responders from the escalation policy (store admins when none are set). The notification text is generic and never includes images or names.')}
      </p>
      <div className="action-row">
        <Button type="submit" pending={m.pending}>
          {t('Escalate')}
        </Button>
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel}>
            {t('Cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
