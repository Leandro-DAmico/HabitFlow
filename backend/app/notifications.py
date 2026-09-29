"""An intentionally inert extension point for future local reminders."""

from __future__ import annotations

from datetime import date
from typing import Protocol


class NotificationPort(Protocol):
    """Boundary for a future opt-in local notification provider."""

    enabled: bool

    def schedule_changed(self, habit_id: str, effective_on: date) -> None:
        """Receive a local schedule change. Implementations must be opt-in."""

    def habit_archived(self, habit_id: str) -> None:
        """Cancel/disable any scheduled delivery for an archived habit."""


class NoopNotificationAdapter:
    """Default adapter: notifications are disabled and no data leaves the device."""

    enabled = False

    def schedule_changed(self, habit_id: str, effective_on: date) -> None:
        del habit_id, effective_on

    def habit_archived(self, habit_id: str) -> None:
        del habit_id
