"""Typed, versioned settings. Defaults are design starting points (reference/domain.py) that
must be calibrated per store; they are labeled as such in the UI."""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, field_validator

from .errors import ApiError

HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class QuietHours(BaseModel):
    start: str
    end: str

    @field_validator("start", "end")
    @classmethod
    def _hhmm(cls, v: str) -> str:
        if not HHMM.match(v):
            raise ValueError("expected HH:MM")
        return v


class GestureRule(BaseModel):
    enabled: bool = True
    min_evidence_seconds: float = Field(default=1.5, ge=0.5, le=30)


class EvidenceGatePolicy(BaseModel):
    anomaly_threshold: float = Field(default=0.75, ge=0, le=1)
    interaction_threshold: float = Field(default=0.6, ge=0, le=1)
    concealment_threshold: float = Field(default=0.6, ge=0, le=1)
    visibility_min: float = Field(default=0.6, ge=0, le=1)
    duration_s: float = Field(default=1.5, gt=0, le=60)
    max_gap_s: float = Field(default=0.6, gt=0, le=10)
    cooldown_s: float = Field(default=30, gt=0, le=3600)


class DetectionRules(BaseModel):
    clothing_concealment: GestureRule = GestureRule()
    backpack_gesture: GestureRule = GestureRule()
    personal_bag_gesture: GestureRule = GestureRule()
    shelf_interaction: GestureRule = GestureRule(enabled=True)
    minimum_evidence: EvidenceGatePolicy = EvidenceGatePolicy()
    calibrated: bool = False  # true only after a calibration is published from reviewed data


class Calibration(BaseModel):
    published: bool = False
    threshold: float | None = Field(default=None, ge=0, le=1)
    reason: str = Field(default="", max_length=2000)
    based_on_reviewed_incidents: int = Field(default=0, ge=0)


class Escalation(BaseModel):
    primary_responder_ids: list[str] = Field(default_factory=list, max_length=50)
    backup_responder_ids: list[str] = Field(default_factory=list, max_length=50)
    ack_deadline_minutes: int = Field(default=5, ge=1, le=240)
    quiet_hours: QuietHours | None = None
    push_privacy: Literal["generic"] = "generic"


class NotificationRouting(BaseModel):
    behavior: bool = True
    watchlist: bool = True
    checkout: bool = True
    rfid: bool = True
    sound: bool = True


class General(BaseModel):
    default_locale: Literal["browser", "ja", "en"] = "browser"
    session_timeout_minutes: int = Field(default=60, ge=5, le=1440)
    currency: Literal["JPY", "USD", "EUR"] = "JPY"
    # Authenticator app (TOTP) for org_admin, store_admin and investigator. Other roles may opt in.
    require_mfa_for_privileged_roles: bool = True


class Privacy(BaseModel):
    raw_video_retention_hours: int = Field(default=72, ge=1, le=24 * 90)
    evidence_retention_days: int = Field(default=90, ge=1, le=3650)
    profile_max_expiry_days: int = Field(default=365, ge=1, le=3650)
    query_photo_ttl_minutes: int = Field(default=60, ge=5, le=1440)
    legal_hold_review_days: int = Field(default=30, ge=1, le=365)
    deletion_contact: str = Field(default="", max_length=300)


STORE_KINDS = {"detection_rules": DetectionRules, "calibration": Calibration, "escalation": Escalation,
               "notification_routing": NotificationRouting}
ORG_KINDS = {"general": General, "privacy": Privacy}


def validate(model: type[BaseModel], data: dict) -> dict:
    try:
        return model.model_validate(data).model_dump(mode="json")
    except ValidationError as exc:
        fields = {".".join(str(p) for p in e["loc"]) or "settings": e["type"] for e in exc.errors()}
        raise ApiError(422, "validation_failed", "Some settings are invalid", field_errors=fields)


def default(model: type[BaseModel]) -> dict:
    return model().model_dump(mode="json")
