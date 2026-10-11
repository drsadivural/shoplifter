// web-28 Enroll a subject: evidence-backed watchlist draft (reference ID, confirmed supporting
// incident, evidence basis, store scope, review date, expiry), then reference photos, then a
// request for review. Never created automatically from an alert or detection.
import '../styles/group-d.css';
import { EnrollWizard } from '../components/groupd/EnrollWizard';

export default function WatchlistEnrollPage() {
  return <EnrollWizard kind="watchlist" />;
}
