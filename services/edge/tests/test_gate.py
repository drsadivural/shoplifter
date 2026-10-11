"""Port of tests/test_domain.py GatingTests onto the durable gate, plus restart persistence."""
import pytest

from retailguard_edge.gate import DurableEvidenceGate, Signal


def sig(t, **kw):
    v = dict(camera_id="c1", track_id="t1", timestamp=t, anomaly=.9, item_interaction=.9,
             concealment_motion=.9, visibility=.9)
    v.update(kw)
    return Signal(**v)


@pytest.fixture
def gate(tmp_path):
    g = DurableEvidenceGate(tmp_path / "gate.db")
    yield g
    g.close()


def test_persistent_correlated_evidence(gate):
    decisions = [gate.evaluate(sig(t)) for t in [0, .5, 1, 1.5]]
    assert [d.emit for d in decisions] == [False, False, False, True]
    assert decisions[-1].reason == "behavior_candidate_requires_review"
    assert (decisions[-1].window_start, decisions[-1].window_end) == (0, 1.5)


def test_anomaly_alone_not_alert(gate):
    assert gate.evaluate(sig(0, item_interaction=.1)).reason == "uncorroborated"


def test_low_visibility_not_alert(gate):
    assert gate.evaluate(sig(0, visibility=.1)).reason == "insufficient_evidence"


def test_gap_resets_window(gate):
    gate.evaluate(sig(0))
    gate.evaluate(sig(.5))
    assert gate.evaluate(sig(2)).reason == "collecting_evidence"


def test_camera_isolation(gate):
    gate.evaluate(sig(0))
    gate.evaluate(sig(.5))
    assert not gate.evaluate(sig(1.5, camera_id="c2")).emit


def test_out_of_order(gate):
    gate.evaluate(sig(2))
    assert gate.evaluate(sig(1)).reason == "out_of_order"


def test_nonfinite_score_rejected(gate):
    with pytest.raises(ValueError):
        gate.evaluate(sig(0, anomaly=float("nan")))
    with pytest.raises(ValueError):
        gate.evaluate(sig(0, anomaly=1.5))


def test_cooldown(gate):
    for t in [0, .5, 1, 1.5]:
        gate.evaluate(sig(t))
    assert gate.evaluate(sig(2)).reason == "cooldown"


def test_track_bound(tmp_path):
    g = DurableEvidenceGate(tmp_path / "g.db", max_tracks=2)
    for i in range(10):
        g.evaluate(sig(i, track_id=str(i)))
    assert g.track_count() == 2


def test_ttl_prunes_tracks(tmp_path):
    g = DurableEvidenceGate(tmp_path / "g.db", ttl=60, cooldown=30)
    g.evaluate(sig(0, track_id="old"))
    g.evaluate(sig(100, track_id="new"))
    assert g.track_count() == 1


def test_invalid_policy(tmp_path):
    with pytest.raises(ValueError):
        DurableEvidenceGate(tmp_path / "g.db", duration=0)
    with pytest.raises(ValueError):
        DurableEvidenceGate(tmp_path / "g.db", ttl=10, cooldown=30)


def test_restart_does_not_reemit_within_cooldown(tmp_path):
    path = tmp_path / "gate.db"
    g = DurableEvidenceGate(path)
    assert [g.evaluate(sig(t)).emit for t in [0, .5, 1, 1.5]][-1] is True
    g.close()
    g2 = DurableEvidenceGate(path)  # process restart
    decisions = [g2.evaluate(sig(t)) for t in [2, 2.5, 3, 3.5, 4]]
    assert not any(d.emit for d in decisions)
    assert decisions[-1].reason == "cooldown"
    # after the cooldown elapses, a fresh window may emit again
    later = [g2.evaluate(sig(t)) for t in [31.6, 32.1, 32.6, 33.1]]
    assert later[-1].emit
    g2.close()


def test_restart_preserves_partial_window(tmp_path):
    path = tmp_path / "gate.db"
    g = DurableEvidenceGate(path)
    g.evaluate(sig(0))
    g.evaluate(sig(.5))
    g.close()
    g2 = DurableEvidenceGate(path)
    g2.evaluate(sig(1))
    assert g2.evaluate(sig(1.5)).emit
