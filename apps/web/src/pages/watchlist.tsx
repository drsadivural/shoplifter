// web-27 Enrolled watchlist. GET /v1/profiles?kind=watchlist (scoped by the server to the viewer's
// stores). Reference photos load through /v1/media/{thumb_media_id} only for photo.read.
import '../styles/group-d.css';
import { PeopleDirectory } from '../components/groupd/PeopleDirectory';

export default function WatchlistPage() {
  return <PeopleDirectory kind="watchlist" />;
}
