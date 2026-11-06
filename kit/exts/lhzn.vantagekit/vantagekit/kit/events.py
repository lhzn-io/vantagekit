"""App update and stage-opened subscriptions through Events 2.0 (carb.eventdispatcher).

Kit 110 logs deprecation warnings for get_update_event_stream and get_stage_event_stream.
Both helpers return an observer that unsubscribes when released (set it to None), and fall
back to the older streams on a Kit without Events 2.0.
"""

from __future__ import annotations

from typing import Any, Callable

import omni.kit.app
import omni.usd


def _dispatcher():
    try:
        import carb.eventdispatcher

        return carb.eventdispatcher.get_eventdispatcher()
    except Exception:
        return None


def on_update(fn: Callable[[float], None], name: str) -> Any:
    """Call fn(dt) once per app update."""
    disp = _dispatcher()
    if disp is not None and hasattr(omni.kit.app, "GLOBAL_EVENT_UPDATE"):
        return disp.observe_event(
            observer_name=name,
            event_name=omni.kit.app.GLOBAL_EVENT_UPDATE,
            on_event=lambda e: fn(float(e["dt"])),
        )
    stream = omni.kit.app.get_app().get_update_event_stream()
    return stream.create_subscription_to_pop(lambda e: fn(float(e.payload["dt"])), name=name)


def on_stage_opened(fn: Callable[[], None], name: str, usd_context=None) -> Any:
    """Call fn() each time a stage finishes opening."""
    ctx = usd_context or omni.usd.get_context()
    disp = _dispatcher()
    if disp is not None and hasattr(ctx, "stage_event_name"):
        return disp.observe_event(
            observer_name=name,
            event_name=ctx.stage_event_name(omni.usd.StageEventType.OPENED),
            on_event=lambda e: fn(),
        )

    def legacy(e):
        if e.type == int(omni.usd.StageEventType.OPENED):
            fn()

    return ctx.get_stage_event_stream().create_subscription_to_pop(legacy, name=name)
