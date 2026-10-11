// Authenticated media + photo upload.
// /v1/media/{id} is same-origin and authorized by the session cookie, so plain <img>/<video>
// work. Responses are `Cache-Control: private, no-store`; never copy media URLs into logs.
import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { mediaUrl } from '../api/client';
import { toApiError } from '../api/hooks';
import type { ApiError } from '../api/client';
import { useI18n } from '../i18n';
import { formatBytes } from '../lib/format';
import { Icon } from './Icon';
import { Button } from './primitives';

export function AuthenticatedImage({
  mediaId,
  alt,
  variant,
  className,
  fallback,
}: {
  mediaId: string;
  /** Required, translated. Describe what the frame shows (e.g. camera + time), not a person's identity. */
  alt: string;
  variant?: 'thumb';
  className?: string;
  fallback?: ReactNode;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  useEffect(() => setState('loading'), [mediaId, variant]);
  if (state === 'error') {
    return (
      <div className={`media-fallback ${className ?? ''}`} role="img" aria-label={alt}>
        {fallback ?? (
          <>
            <Icon name="warning" />
            <span>{t('Image unavailable')}</span>
          </>
        )}
      </div>
    );
  }
  return (
    <img
      className={`${className ?? ''} ${state === 'loading' ? 'media-loading' : ''}`}
      src={mediaUrl(mediaId, variant)}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="same-origin"
      onLoad={() => setState('loaded')}
      onError={() => setState('error')}
    />
  );
}

export function AuthenticatedVideo({ mediaId, label, className }: { mediaId: string; label: string; className?: string }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [mediaId]);
  if (failed) {
    return (
      <div className={`media-fallback ${className ?? ''}`} role="img" aria-label={label}>
        <Icon name="warning" />
        <span>{t('The evidence clip could not be played. It may have expired or been removed.')}</span>
      </div>
    );
  }
  return (
    <video className={className} controls preload="metadata" aria-label={label} onError={() => setFailed(true)} playsInline>
      <source src={mediaUrl(mediaId)} />
      {t('Your browser cannot play this clip.')}
    </video>
  );
}

// ------------------------------------------------------------------ PhotoUpload

export interface PhotoUploadProps {
  label: string;
  hint?: string;
  /** Accepted MIME types. Default JPEG/PNG (server re-validates the content). */
  accept?: string[];
  /** Max bytes. Default 8 MB (docs/API_V1.md). */
  maxBytes?: number;
  /** Minimum width/height in px. Default 200. */
  minDimension?: number;
  /** Max megapixels. Default 40. */
  maxMegapixels?: number;
  /** Performs the upload; call onProgress(0..1). Resolve on success, throw ApiError on failure. */
  upload: (file: File, onProgress: (fraction: number) => void) => Promise<unknown>;
  onUploaded?: (result: unknown) => void;
  disabled?: boolean;
}

export async function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(file);
      const size = { width: bmp.width, height: bmp.height };
      bmp.close?.();
      return size;
    }
  } catch {
    return null;
  }
  return null;
}

/** Client-side precheck (type/size/dimensions). Returns an i18n key + vars, or null when OK. */
export async function precheckPhoto(
  file: File,
  opts: { accept: string[]; maxBytes: number; minDimension: number; maxMegapixels: number },
): Promise<{ key: string; vars?: Record<string, string | number> } | null> {
  if (!opts.accept.includes(file.type)) return { key: 'Only JPEG or PNG photos can be uploaded.' };
  if (file.size > opts.maxBytes) return { key: 'The photo is larger than {max}.', vars: { max: formatBytes(opts.maxBytes, 'en') } };
  const size = await readImageSize(file);
  if (size) {
    if (size.width < opts.minDimension || size.height < opts.minDimension)
      return { key: 'The photo must be at least {min} × {min} pixels.', vars: { min: opts.minDimension } };
    if ((size.width * size.height) / 1e6 > opts.maxMegapixels)
      return { key: 'The photo must be at most {mp} megapixels.', vars: { mp: opts.maxMegapixels } };
  }
  return null;
}

export function PhotoUpload({
  label,
  hint,
  accept = ['image/jpeg', 'image/png'],
  maxBytes = 8 * 1024 * 1024,
  minDimension = 200,
  maxMegapixels = 40,
  upload,
  onUploaded,
  disabled,
}: PhotoUploadProps) {
  const { t } = useI18n();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const choose = async (f: File | undefined) => {
    setApiError(null);
    if (!f) return;
    const problem = await precheckPhoto(f, { accept, maxBytes, minDimension, maxMegapixels });
    if (problem) {
      setError(t(problem.key, problem.vars));
      setFile(null);
      setPreview(null);
      return;
    }
    setError(null);
    setFile(f);
    setPreview(typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : null);
  };

  const start = async () => {
    if (!file) return;
    setProgress(0);
    setApiError(null);
    try {
      const result = await upload(file, setProgress);
      setProgress(null);
      setFile(null);
      setPreview(null);
      if (inputRef.current) inputRef.current.value = '';
      onUploaded?.(result);
    } catch (e) {
      setProgress(null);
      setApiError(toApiError(e));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!disabled) void choose(e.dataTransfer.files?.[0]);
  };

  return (
    <div className="photo-upload">
      <div
        className={`upload ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <Icon name="upload" size={24} />
        <label htmlFor={inputId} className="upload-label">
          {label}
        </label>
        <div className="help">{hint ?? t('Drag a photo here or choose a file. JPEG or PNG, up to {max}, at least {min} × {min} px.', { max: formatBytes(maxBytes, 'en'), min: minDimension })}</div>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept.join(',')}
          disabled={disabled || progress !== null}
          onChange={(e) => void choose(e.target.files?.[0])}
        />
      </div>
      {error ? (
        <div className="field-error" role="alert">
          {error}
        </div>
      ) : null}
      {file ? (
        <div className="upload-selected">
          {preview ? <img src={preview} alt={t('Selected photo preview')} className="upload-preview" /> : null}
          <div className="upload-meta">
            <div>{file.name}</div>
            <div className="muted small">{formatBytes(file.size, 'en')}</div>
            {progress !== null ? (
              <progress max={1} value={progress} aria-label={t('Upload progress')}>
                {Math.round(progress * 100)}%
              </progress>
            ) : null}
          </div>
          <Button onClick={start} pending={progress !== null} disabled={disabled}>
            {t('Upload')}
          </Button>
        </div>
      ) : null}
      {apiError ? (
        <div className="field-error" role="alert">
          {apiError.status === 422 ? t('The server rejected this photo: {message}', { message: apiError.message }) : apiError.message}
          {apiError.requestId ? <span className="mono small"> · {t('Request ID')}: {apiError.requestId}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
