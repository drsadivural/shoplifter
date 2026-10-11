// Accessible modal dialog: role="dialog" + aria-modal, focus trap, Esc to close, focus restored
// to the opener on close. ConfirmDialog requires a written reason for consequential commands.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { TextAreaField } from './forms';
import { Button, type ButtonVariant } from './primitives';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Prevent closing via Esc/backdrop while a command is pending. */
  dismissible?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function Modal({ open, onClose, title, description, children, footer, dismissible = true, size = 'md' }: ModalProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissibleRef.current) {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === 'Tab' && node) {
        const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const firstEl = items[0]!;
        const lastEl = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          {dismissible ? (
            <button type="button" className="icon-btn" aria-label={t('Close')} onClick={onClose}>
              ×
            </button>
          ) : null}
        </div>
        {description ? (
          <p id={descId} className="muted">
            {description}
          </p>
        ) : null}
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  /** Called with the trimmed reason. Return/resolve true to close the dialog. */
  onConfirm: (reason: string) => Promise<boolean> | boolean;
  pending?: boolean;
  /** Default true: a written reason is mandatory. */
  requireReason?: boolean;
  reasonLabel?: string;
  reasonHint?: string;
  minReasonLength?: number;
  /** Inline server error (already translated). */
  error?: string | null;
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  confirmVariant = 'primary',
  onConfirm,
  pending = false,
  requireReason = true,
  reasonLabel,
  reasonHint,
  minReasonLength = 3,
  error,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);
  const trimmed = reason.trim();
  const invalid = requireReason && trimmed.length < minReasonLength;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid || pending) return;
    const close = await onConfirm(trimmed);
    if (close) onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={title} description={description} dismissible={!pending} size="sm">
      <form onSubmit={submit} noValidate>
        {requireReason ? (
          <TextAreaField
            label={reasonLabel ?? t('Reason')}
            hint={reasonHint ?? t('Recorded in the audit log with your name.')}
            required
            data-autofocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            error={touched && invalid ? t('Enter a reason of at least {n} characters.', { n: minReasonLength }) : null}
          />
        ) : null}
        {error ? (
          <div className="field-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="modal-foot">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('Cancel')}
          </Button>
          <Button type="submit" variant={confirmVariant} pending={pending}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
