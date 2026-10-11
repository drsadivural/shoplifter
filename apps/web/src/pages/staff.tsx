// web-31 Staff directory. GET /v1/profiles?kind=staff. Staff reference photos are shown only to
// staff.manage (the media API enforces the same rule); staff are not app user accounts.
import '../styles/group-d.css';
import { PeopleDirectory } from '../components/groupd/PeopleDirectory';

export default function StaffPage() {
  return <PeopleDirectory kind="staff" />;
}
