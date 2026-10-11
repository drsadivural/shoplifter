// web-29 Watchlist profile (?id=): approved photos, evidence basis, visit history (linked incidents),
// match candidates (explicitly unavailable without the licensed face SDK), suspend / reinstate /
// delete with a reason, and edits that reset approval when material.
import '../styles/group-d.css';
import { ProfileDetailPage } from '../components/groupd/ProfileDetail';

export default function WatchlistDetailPage() {
  return <ProfileDetailPage kind="watchlist" />;
}
