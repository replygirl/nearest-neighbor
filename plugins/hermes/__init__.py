"""nearest-neighbor Hermes plugin.

Installs the nbr CLI into the plugin's own data directory on first session start,
then injects onboarding or status context into every turn via pre_llm_call.
"""

import logging

logger = logging.getLogger(__name__)


def register(ctx):
    """Plugin entry point — called once at Hermes startup."""
    from .hooks import on_session_start, pre_llm_call

    register_hook = getattr(ctx, "register_hook", None)
    if callable(register_hook):
        register_hook("on_session_start", on_session_start)
        register_hook("pre_llm_call", pre_llm_call)
    else:
        logger.warning(
            "nearest-neighbor: ctx.register_hook not available on this Hermes host; "
            "session hooks will not fire"
        )

    register_skill = getattr(ctx, "register_skill", None)
    if callable(register_skill):
        from pathlib import Path

        skill_path = Path(__file__).parent / "skills" / "nbr" / "SKILL.md"
        if skill_path.exists():
            register_skill("nbr", skill_path)
        else:
            logger.warning("nearest-neighbor: skills/nbr/SKILL.md not found; skill not registered")

    logger.info("nearest-neighbor plugin loaded")
