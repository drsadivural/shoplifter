"""Evidence gating for supplied signals. This is not an image/face inference model."""
from dataclasses import dataclass
import math

@dataclass(frozen=True)
class Signal:
    camera_id: str
    track_id: str
    timestamp: float
    anomaly: float
    item_interaction: float
    concealment_motion: float
    visibility: float

@dataclass(frozen=True)
class Decision:
    emit: bool
    reason: str

class EvidenceGate:
    """Bounded temporal gate; production adds durable outbox/cooldown storage."""
    def __init__(self, duration=1.5, max_gap=.6, cooldown=30., ttl=120., max_tracks=4096):
        if any(not math.isfinite(v) or v<=0 for v in (duration,max_gap,cooldown,ttl)) or max_tracks<1:
            raise ValueError('Invalid policy')
        self.duration,self.max_gap,self.cooldown,self.ttl,self.max_tracks=duration,max_gap,cooldown,ttl,max_tracks
        self.state={}
    def evaluate(self,s):
        scores=(s.anomaly,s.item_interaction,s.concealment_motion,s.visibility)
        if not s.camera_id or not s.track_id or not math.isfinite(s.timestamp) or any(not math.isfinite(v) or not 0<=v<=1 for v in scores):
            raise ValueError('Invalid supplied signal')
        for k,v in list(self.state.items()):
            if s.timestamp-v['last']>self.ttl:self.state.pop(k)
        key=(s.camera_id,s.track_id)
        if key not in self.state:
            if len(self.state)>=self.max_tracks:
                self.state.pop(min(self.state,key=lambda k:self.state[k]['last']))
            self.state[key]={'last':s.timestamp,'start':None,'emitted':None}
        st=self.state[key]
        if s.timestamp<st['last']:return Decision(False,'out_of_order')
        if s.timestamp-st['last']>self.max_gap:st['start']=None
        st['last']=s.timestamp
        if s.visibility<.6:
            st['start']=None;return Decision(False,'insufficient_evidence')
        if not(s.anomaly>=.75 and s.item_interaction>=.6 and s.concealment_motion>=.6):
            st['start']=None;return Decision(False,'uncorroborated')
        if st['emitted'] is not None and s.timestamp-st['emitted']<self.cooldown:return Decision(False,'cooldown')
        if st['start'] is None:st['start']=s.timestamp
        if s.timestamp-st['start']<self.duration:return Decision(False,'collecting_evidence')
        st['emitted']=s.timestamp;st['start']=None
        return Decision(True,'behavior_candidate_requires_review')

TRANSITIONS={'acknowledge':({'new'},'acknowledged'),'review':({'acknowledged'},'reviewing'),'resolve':({'acknowledged','reviewing'},'resolved')}
OUTCOMES={'confirmed','false_alert','inconclusive'}
def validate_transition(record,action,expected_version,actor_id,reason,outcome=None):
    if type(expected_version) is not int or expected_version!=record['version']:raise ValueError('version_conflict')
    if action not in TRANSITIONS:raise ValueError('invalid_action')
    allowed,status=TRANSITIONS[action]
    if record['status'] not in allowed:raise ValueError('invalid_transition')
    if record.get('assignee') and record['assignee']!=actor_id:raise ValueError('owned_by_another_responder')
    if not isinstance(reason,str) or not reason.strip() or len(reason)>2000:raise ValueError('reason_required')
    if action=='resolve' and outcome not in OUTCOMES:raise ValueError('invalid_outcome')
    return status
