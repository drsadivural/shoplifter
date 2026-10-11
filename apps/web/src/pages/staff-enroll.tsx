// web-32 Enroll staff: employee ID, display name, store assignment, role context, recorded photo
// notice and expiry, then reference photos and a request for review. Staff profiles are not
// user accounts and never exempt anyone from checkout review.
import '../styles/group-d.css';
import { EnrollWizard } from '../components/groupd/EnrollWizard';

export default function StaffEnrollPage() {
  return <EnrollWizard kind="staff" />;
}
