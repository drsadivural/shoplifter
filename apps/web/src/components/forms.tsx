// Form controls. FormField wires label / hint / inline error / required marker to its control
// through ids + aria-describedby + aria-invalid. Prefer the *Field shorthands.
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { translate, useI18n } from '../i18n';
import type { Locale } from '../api/types';

export interface ControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  required?: boolean;
}

export interface FormFieldProps {
  label: ReactNode;
  hint?: ReactNode;
  /** Already-translated inline error text (see fieldErrorText for server codes). */
  error?: string | null;
  required?: boolean;
  /** Render the control with the wiring props. */
  children: (control: ControlProps) => ReactNode;
  className?: string;
}

export function FormField({ label, hint, error, required, children, className }: FormFieldProps) {
  const { t } = useI18n();
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${error ? 'field-invalid' : ''} ${className ?? ''}`}>
      <label htmlFor={id}>
        {label}
        {required ? (
          <span className="required-marker" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
        {required ? <span className="visually-hidden"> ({t('required')})</span> : null}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, required })}
      {hint ? (
        <div className="help" id={hintId}>
          {hint}
        </div>
      ) : null}
      {error ? (
        <div className="field-error" id={errId}>
          <span aria-hidden="true">▲ </span>
          {error}
        </div>
      ) : null}
    </div>
  );
}

/** Translate a server field error code (422 field_errors) into a message. */
export function fieldErrorText(code: string | undefined | null, locale: Locale): string | null {
  if (!code) return null;
  const key = `field_error|${code}`;
  const text = translate(locale, key);
  return text === code ? translate(locale, 'This value is not valid ({code}).', { code }) : text;
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={`input ${className ?? ''}`} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={`input select ${className ?? ''}`} {...rest}>
      {children}
    </select>
  );
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, rows = 4, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={`input textarea ${className ?? ''}`} {...rest} />;
});

type FieldShared = { label: ReactNode; hint?: ReactNode; error?: string | null; required?: boolean; className?: string };

export function TextField({ label, hint, error, required, className, ...input }: FieldShared & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FormField label={label} hint={hint} error={error} required={required} className={className}>
      {(p) => <TextInput {...input} {...p} />}
    </FormField>
  );
}

export function SelectField({
  label,
  hint,
  error,
  required,
  className,
  options,
  placeholder,
  ...select
}: FieldShared &
  SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <FormField label={label} hint={hint} error={error} required={required} className={className}>
      {(p) => (
        <Select {...select} {...p}>
          {placeholder !== undefined ? (
            <option value="" disabled={required}>
              {placeholder}
            </option>
          ) : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </FormField>
  );
}

export function TextAreaField({ label, hint, error, required, className, ...ta }: FieldShared & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FormField label={label} hint={hint} error={error} required={required} className={className}>
      {(p) => <TextArea {...ta} {...p} />}
    </FormField>
  );
}

/** Checkbox with its label on the right. */
export function Checkbox({ label, hint, ...input }: { label: ReactNode; hint?: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const id = useId();
  return (
    <div className="checkbox-row">
      <input type="checkbox" id={id} aria-describedby={hint ? `${id}-hint` : undefined} {...input} />
      <div>
        <label htmlFor={id}>{label}</label>
        {hint ? (
          <div className="help" id={`${id}-hint`}>
            {hint}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Switch (role="switch"). The visible label is required; state text is announced by aria-checked. */
export function Toggle({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  const id = useId();
  const { t } = useI18n();
  return (
    <div className="toggle-row">
      <div>
        <span id={`${id}-label`} className="toggle-label">
          {label}
        </span>
        {hint ? (
          <div className="help" id={`${id}-hint`}>
            {hint}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        disabled={disabled}
        className={`toggle ${checked ? 'on' : 'off'}`}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle-text">{checked ? t('On') : t('Off')}</span>
      </button>
    </div>
  );
}
