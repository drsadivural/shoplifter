import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'reference'))
from domain import EvidenceGate,Signal,validate_transition
class GatingTests(unittest.TestCase):
    def signal(self,t,**kw):
        v=dict(camera_id='c1',track_id='t1',timestamp=t,anomaly=.9,item_interaction=.9,concealment_motion=.9,visibility=.9);v.update(kw);return Signal(**v)
    def test_persistent_correlated_evidence(self):
        g=EvidenceGate();decisions=[g.evaluate(self.signal(t)) for t in [0,.5,1,1.5]];self.assertEqual([x.emit for x in decisions],[False,False,False,True])
    def test_anomaly_alone_not_alert(self):self.assertEqual(EvidenceGate().evaluate(self.signal(0,item_interaction=.1)).reason,'uncorroborated')
    def test_low_visibility_not_alert(self):self.assertEqual(EvidenceGate().evaluate(self.signal(0,visibility=.1)).reason,'insufficient_evidence')
    def test_gap_resets_window(self):
        g=EvidenceGate();g.evaluate(self.signal(0));g.evaluate(self.signal(.5));self.assertEqual(g.evaluate(self.signal(2)).reason,'collecting_evidence')
    def test_camera_isolation(self):
        g=EvidenceGate();g.evaluate(self.signal(0));g.evaluate(self.signal(.5));self.assertFalse(g.evaluate(self.signal(1.5,camera_id='c2')).emit)
    def test_out_of_order(self):
        g=EvidenceGate();g.evaluate(self.signal(2));self.assertEqual(g.evaluate(self.signal(1)).reason,'out_of_order')
    def test_nonfinite_score_rejected(self):
        with self.assertRaises(ValueError):EvidenceGate().evaluate(self.signal(0,anomaly=float('nan')))
    def test_cooldown(self):
        g=EvidenceGate()
        for t in [0,.5,1,1.5]:g.evaluate(self.signal(t))
        self.assertEqual(g.evaluate(self.signal(2)).reason,'cooldown')
    def test_track_bound(self):
        g=EvidenceGate(max_tracks=2)
        for i in range(10):g.evaluate(self.signal(i,track_id=str(i)))
        self.assertEqual(len(g.state),2)
class TransitionTests(unittest.TestCase):
    def test_claim(self):self.assertEqual(validate_transition({'status':'new','version':1,'assignee':None},'acknowledge',1,'u1','Review started'),'acknowledged')
    def test_stale_version_rejected(self):
        with self.assertRaisesRegex(ValueError,'version_conflict'):validate_transition({'status':'new','version':2},'acknowledge',1,'u1','Review')
    def test_other_owner_rejected(self):
        with self.assertRaisesRegex(ValueError,'owned_by_another'):validate_transition({'status':'acknowledged','version':2,'assignee':'u2'},'resolve',2,'u1','Review','confirmed')
    def test_reason_required(self):
        with self.assertRaisesRegex(ValueError,'reason_required'):validate_transition({'status':'new','version':1},'acknowledge',1,'u1','')
    def test_resolve_outcome_required(self):
        with self.assertRaisesRegex(ValueError,'invalid_outcome'):validate_transition({'status':'reviewing','version':3,'assignee':'u1'},'resolve',3,'u1','Review','guilty')
if __name__=='__main__':unittest.main()
