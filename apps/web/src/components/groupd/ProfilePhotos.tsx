// Reference photos of one profile: upload (multipart `file` + `provenance`), measured image
// quality, per-photo approve/reject with a reason, and deletion. Face quality and templates
// need the licensed SDK and are reported as unavailable, never estimated.
import { useState } from 'react';
import { ApiError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import { useMutation } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { TextField } from '../forms';
import { AuthenticatedImage, PhotoUpload } from '../media';
import { ConfirmDialog } from '../Modal';
import { Button } from '../primitives';
import { EmptyState, UnavailableNotice } from '../states';
import type { PhotoD, ProfileDetailD } from './api';
import { apiErrorText, CODE_MESSAGE, fieldMessage } from './errors';
import { PhotoQuality, PhotoStatusPill } from './ui';

type Pending = { kind: 'approve' | 'reject' | 'delete'; photo: PhotoD } | null;

export function ProfilePhotos({
  profile,
  timeZone,
  canUpload,
  canDelete,
  canReview,
  onChanged,
  emptyText,
}: {
  profile: ProfileDetailD;
  timeZone: string;
  canUpload: boolean;
  canDelete: boolean;
  canReview: boolean;
  onChanged: () => void;
  emptyText?: string;
}) {
  const { t, fmt, locale } = useI18n();
  const [provenance, setProvenance] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const editable = profile.status !== 'deleted';

  const review = useMutation(
    (a: { photo: PhotoD; decision: 'approved' | 'rejected'; reason: string }) =>
      endpoints.profiles.reviewPhoto(profile.id, a.photo.id, { decision: a.decision, reason: a.reason }),
    {
      successMessage: (p) => (p.status === 'approved' ? t('Photo approved') : t('Photo rejected')),
      onSuccess: onChanged,
      onError: (e) => e.status === 422 || e.code in CODE_MESSAGE,
    },
  );
  const remove = useMutation((photo: PhotoD) => endpoints.profiles.deletePhoto(profile.id, photo.id), {
    successMessage: t('Photo deleted'),
    onSuccess: onChanged,
  });

  const upload = async (file: File, onProgress: (f: number) => void) => {
    try {
      return await endpoints.profiles.uploadPhoto(profile.id, file, provenance.trim(), { onProgress });
    } catch (e) {
      // Re-throw with a localized message (the shared uploader shows err.message).
      if (e instanceof ApiError) {
        const fieldCode = e.fieldErrors.file ?? e.fieldErrors.provenance;
        const msg = fieldCode ? fieldMessage(fieldCode, locale) : e.code in CODE_MESSAGE ? apiErrorText(e, locale) : null;
        if (msg) {
          throw new ApiError({ status: e.status === 422 ? 400 : e.status, code: e.code, message: msg, requestId: e.requestId });
        }
      }
      throw e;
    }
  };

  const photos = profile.photos;
  const label = (p: PhotoD) => t('Reference photo for {ref}', { ref: profile.reference }) + ` · ${fmt.dateTime(p.created_at, timeZone, { seconds: false })}`;

  return (
    <div className="gd-photos">
      <UnavailableNotice title={t('Face quality checks unavailable — licensed SDK not installed')}>
        {t('Only measured image statistics (resolution, sharpness, exposure) are checked. Face count, pose and template extraction need the licensed Ayonix face SDK.')}
      </UnavailableNotice>
      {photos.length === 0 ? (
        <EmptyState compact icon="upload" title={emptyText ?? t('No reference photos yet')} />
      ) : (
        <ul className="gd-photo-grid" aria-label={t('Reference photos')}>
          {photos.map((p) => (
            <li key={p.id} className="gd-photo">
              <AuthenticatedImage mediaId={p.thumb_media_id} alt={label(p)} className="gd-photo-img" />
              <div className="gd-photo-meta">
                <PhotoStatusPill status={p.status} />
                <div className="small">
                  <span className="muted">{t('Source')}:</span> {p.provenance}
                </div>
                <div className="muted small">{fmt.dateTime(p.created_at, timeZone, { seconds: false })}</div>
                <PhotoQuality photo={p} compact />
                {p.review_reason ? (
                  <div className="small">
                    <span className="muted">{t('Review reason')}:</span> {p.review_reason}
                  </div>
                ) : null}
                {editable && (canReview || canDelete) ? (
                  <div className="gd-photo-actions">
                    {canReview && p.status !== 'approved' ? (
                      <Button size="sm" onClick={() => setPending({ kind: 'approve', photo: p })}>
                        {t('Approve photo')}
                      </Button>
                    ) : null}
                    {canReview && p.status !== 'rejected' ? (
                      <Button size="sm" variant="secondary" onClick={() => setPending({ kind: 'reject', photo: p })}>
                        {t('Reject photo')}
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button size="sm" variant="ghost" onClick={() => setPending({ kind: 'delete', photo: p })}>
                        {t('Delete photo')}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canUpload && editable ? (
        <div className="gd-upload">
          <TextField
            label={t('Photo source (provenance)')}
            hint={t('Where the photo came from, e.g. the camera and time of the confirmed incident. Required for every photo.')}
            required
            maxLength={500}
            value={provenance}
            onChange={(e) => setProvenance(e.target.value)}
          />
          {provenance.trim() ? (
            <PhotoUpload label={t('Upload a reference photo')} upload={upload} onUploaded={onChanged} />
          ) : (
            <p className="muted small">{t('Enter the photo source to add a photo.')}</p>
          )}
          {profile.status === 'approved' ? (
            <p className="small gd-warn">{t('Adding a photo returns this approved profile to review.')}</p>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={pending?.kind === 'approve' || pending?.kind === 'reject'}
        onClose={() => {
          setPending(null);
          review.reset();
        }}
        title={pending?.kind === 'approve' ? t('Approve photo') : t('Reject photo')}
        description={
          pending?.kind === 'approve'
            ? t('Confirm the photo shows the same subject, is clear enough to review and has a permitted source.')
            : t('Explain why this photo should not be used.')
        }
        confirmLabel={pending?.kind === 'approve' ? t('Approve photo') : t('Reject photo')}
        confirmVariant={pending?.kind === 'reject' ? 'danger' : 'primary'}
        pending={review.pending}
        error={review.error ? apiErrorText(review.error, locale) : null}
        onConfirm={async (reason) =>
          pending ? (await review.run({ photo: pending.photo, decision: pending.kind === 'approve' ? 'approved' : 'rejected', reason })).ok : false
        }
      />
      <ConfirmDialog
        open={pending?.kind === 'delete'}
        onClose={() => setPending(null)}
        title={t('Delete photo')}
        description={t('The photo, its thumbnail and any face template are deleted. This cannot be undone and is recorded in the audit log.')}
        confirmLabel={t('Delete photo')}
        confirmVariant="danger"
        requireReason={false}
        pending={remove.pending}
        onConfirm={async () => (pending ? (await remove.run(pending.photo)).ok : false)}
      />
    </div>
  );
}
