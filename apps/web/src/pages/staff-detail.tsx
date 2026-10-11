// web-33 Staff profile (?id=): reference photos (staff.manage only), assigned stores, match history
// (unavailable without the licensed face SDK), detection policy, approve flow and deactivation
// (= suspend). Staff recognition never suppresses checkout exceptions.
import '../styles/group-d.css';
import { ProfileDetailPage } from '../components/groupd/ProfileDetail';

export default function StaffDetailPage() {
  return <ProfileDetailPage kind="staff" />;
}
