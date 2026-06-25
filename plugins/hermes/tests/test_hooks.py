"""Unit tests for plugins/hermes/hooks.py.

All tests are hermetic — no network, no real nbr binary, no real install script.
Module-level state (_FIRST_TURN_SEEN, _NBR_BIN, _LAST_STATUS_FILE) is
monkeypatched or reset between tests.
"""

import json
from unittest.mock import MagicMock, patch

import plugins.hermes.hooks as hooks
import pytest  # noqa: E402

# ── helpers ───────────────────────────────────────────────────────────────────


def _status(**kwargs) -> str:
    """Build a minimal authed status JSON string."""
    base = {
        "unread_messages": 0,
        "new_matches": 0,
        "new_likes": 0,
        "new_followers": 0,
        "elevated": [],
    }
    base.update(kwargs)
    return json.dumps(base)


@pytest.fixture(autouse=True)
def reset_first_turn_seen():
    """Clear _FIRST_TURN_SEEN before every test."""
    hooks._FIRST_TURN_SEEN.clear()
    yield
    hooks._FIRST_TURN_SEEN.clear()


# ── _is_authed ────────────────────────────────────────────────────────────────


class TestIsAuthed:
    def test_true_when_unread_messages_present(self):
        assert hooks._is_authed(_status(unread_messages=0)) is True

    def test_true_with_nonzero_unread(self):
        assert hooks._is_authed(_status(unread_messages=5)) is True

    def test_false_on_empty_string(self):
        assert hooks._is_authed("") is False

    def test_false_on_junk_string(self):
        assert hooks._is_authed("not json at all") is False

    def test_false_on_json_without_key(self):
        assert hooks._is_authed('{"error": "unauthorized"}') is False

    def test_false_on_empty_object(self):
        assert hooks._is_authed("{}") is False

    def test_false_on_null(self):
        assert hooks._is_authed("null") is False

    def test_false_on_none(self):
        assert hooks._is_authed(None) is False  # type: ignore[arg-type]


# ── _build_delta_context ──────────────────────────────────────────────────────


class TestBuildDeltaContext:
    def test_returns_none_when_no_deltas_and_no_elevated(self):
        current = json.loads(_status())
        last = json.loads(_status())
        assert hooks._build_delta_context(current, last) is None

    def test_returns_none_when_counts_equal_and_empty_elevated(self):
        payload = json.loads(_status(unread_messages=3, new_matches=1))
        assert hooks._build_delta_context(payload, payload) is None

    def test_reports_new_messages(self):
        current = json.loads(_status(unread_messages=3))
        last = json.loads(_status(unread_messages=1))
        result = hooks._build_delta_context(current, last)
        assert result is not None
        assert "2 new message(s)" in result

    def test_reports_new_matches(self):
        current = json.loads(_status(new_matches=4))
        last = json.loads(_status(new_matches=2))
        result = hooks._build_delta_context(current, last)
        assert result is not None
        assert "2 new match(es)" in result

    def test_reports_new_likes(self):
        current = json.loads(_status(new_likes=5))
        last = json.loads(_status(new_likes=3))
        result = hooks._build_delta_context(current, last)
        assert result is not None
        assert "2 new like(s)" in result

    def test_reports_new_followers(self):
        current = json.loads(_status(new_followers=2))
        last = json.loads(_status(new_followers=0))
        result = hooks._build_delta_context(current, last)
        assert result is not None
        assert "2 new follower(s)" in result

    def test_includes_elevated_when_present(self):
        current = json.loads(_status(elevated=["urgent_match"]))
        last = json.loads(_status())
        result = hooks._build_delta_context(current, last)
        assert result is not None
        assert "Elevated" in result
        assert "urgent_match" in result

    def test_elevated_only_no_count_deltas(self):
        # No numeric deltas but elevated list is non-empty — should still return something.
        current = json.loads(_status(elevated=["ping"]))
        last = json.loads(_status())
        result = hooks._build_delta_context(current, last)
        assert result is not None
        assert "Elevated activity" in result

    def test_combined_deltas_and_elevated(self):
        current = json.loads(_status(unread_messages=2, elevated=["alert"]))
        last = json.loads(_status(unread_messages=0))
        result = hooks._build_delta_context(current, last)
        assert result is not None
        assert "new message(s)" in result
        assert "Elevated" in result

    def test_negative_delta_ignored(self):
        # Counts going down (e.g. messages read) should not be reported.
        current = json.loads(_status(unread_messages=1))
        last = json.loads(_status(unread_messages=5))
        assert hooks._build_delta_context(current, last) is None

    def test_result_contains_run_nbr_status_hint(self):
        current = json.loads(_status(unread_messages=1))
        last = json.loads(_status())
        result = hooks._build_delta_context(current, last)
        assert result is not None
        assert "nbr status" in result


# ── _build_onboarding_context ─────────────────────────────────────────────────


class TestBuildOnboardingContext:
    def test_contains_signup_command(self):
        text = hooks._build_onboarding_context()
        assert "nbr auth signup" in text

    def test_contains_tagline(self):
        text = hooks._build_onboarding_context()
        assert "Affection is all you need" in text

    def test_contains_skill_reference(self):
        text = hooks._build_onboarding_context()
        assert "nearest-neighbor:nbr" in text


# ── _build_status_context ─────────────────────────────────────────────────────


class TestBuildStatusContext:
    def _whoami(self, first_name="Aria", handle="aria"):
        return (True, json.dumps({"first_name": first_name, "handle": handle}))

    def test_contains_signed_in_name_and_handle(self):
        status = _status(unread_messages=3, new_matches=1, new_likes=2)
        with patch.object(hooks, "_run_nbr", return_value=self._whoami()):
            text = hooks._build_status_context(status)
        assert "Aria" in text
        assert "@aria" in text

    def test_contains_counts(self):
        status = _status(unread_messages=3, new_matches=1, new_likes=2)
        with patch.object(hooks, "_run_nbr", return_value=self._whoami()):
            text = hooks._build_status_context(status)
        assert "3 unread messages" in text
        assert "1 new matches" in text
        assert "2 new likes" in text

    def test_handles_missing_whoami(self):
        # When whoami returns junk, name falls back to "(unnamed)".
        status = _status()
        with patch.object(hooks, "_run_nbr", return_value=(False, "")):
            text = hooks._build_status_context(status)
        assert "(unnamed)" in text

    def test_contains_quick_start_hints(self):
        status = _status()
        with patch.object(hooks, "_run_nbr", return_value=self._whoami()):
            text = hooks._build_status_context(status)
        assert "nbr deck next" in text

    def test_handle_only_display(self):
        status = _status()
        with patch.object(hooks, "_run_nbr", return_value=(True, json.dumps({"handle": "bot"}))):
            text = hooks._build_status_context(status)
        assert "@bot" in text

    def test_first_name_only_display(self):
        status = _status()
        with patch.object(
            hooks,
            "_run_nbr",
            return_value=(True, json.dumps({"first_name": "Neo"})),
        ):
            text = hooks._build_status_context(status)
        assert "Neo" in text
        # No @-prefix when handle is absent
        assert "@ " not in text


# ── pre_llm_call ──────────────────────────────────────────────────────────────


class TestPreLlmCall:
    """Tests for the main injection hook."""

    _CALL_DEFAULTS = {
        "user_message": "hello",
        "conversation_history": [],
        "model": "claude-3-5-sonnet",
        "platform": "hermes",
    }

    def _call(self, session_id="sess-1", is_first_turn=True, **overrides):
        kw = {**self._CALL_DEFAULTS, **overrides}
        return hooks.pre_llm_call(
            session_id=session_id,
            is_first_turn=is_first_turn,
            **kw,
        )

    # ── first turn, nbr not present ───────────────────────────────────────────

    def test_first_turn_nbr_missing_returns_not_available_notice(self, tmp_path):
        fake_bin = tmp_path / "nbr"  # does NOT exist

        with patch.object(hooks, "_NBR_BIN", fake_bin):
            result = self._call()

        assert result is not None
        assert "context" in result
        assert "not yet available" in result["context"]

    # ── first turn, unauthed ──────────────────────────────────────────────────

    def test_first_turn_unauthed_returns_onboarding(self, tmp_path):
        fake_bin = tmp_path / "nbr"
        fake_bin.write_text("#!/bin/sh\n")
        fake_bin.chmod(0o755)

        def mock_run(*args, **kwargs):
            return (False, "")

        with (
            patch.object(hooks, "_NBR_BIN", fake_bin),
            patch.object(hooks, "_run_nbr", mock_run),
        ):
            result = self._call()

        assert result is not None
        assert "nbr auth signup" in result["context"]
        assert "Affection is all you need" in result["context"]

    # ── first turn, authed ────────────────────────────────────────────────────

    def test_first_turn_authed_returns_status_context_and_primes_snapshot(self, tmp_path):
        fake_bin = tmp_path / "nbr"
        fake_bin.write_text("#!/bin/sh\n")
        fake_bin.chmod(0o755)
        state_file = tmp_path / "last-status.json"

        status_payload = _status(unread_messages=2, new_matches=1, new_likes=0)
        whoami_payload = json.dumps({"first_name": "Aria", "handle": "aria"})

        call_count = [0]

        def mock_run(*args, **kwargs):
            call_count[0] += 1
            cmd = args[0] if args else ""
            if cmd == "whoami":
                return (True, whoami_payload)
            if cmd == "login":
                return (True, "")
            # status calls
            return (True, status_payload)

        with (
            patch.object(hooks, "_NBR_BIN", fake_bin),
            patch.object(hooks, "_run_nbr", mock_run),
            patch.object(hooks, "_LAST_STATUS_FILE", state_file),
        ):
            result = self._call()
            # snapshot should be written
            assert state_file.exists()
            saved = json.loads(state_file.read_text())
            assert saved["unread_messages"] == 2

        assert result is not None
        assert "Aria" in result["context"]
        assert "2 unread messages" in result["context"]
        assert "sess-1" in hooks._FIRST_TURN_SEEN

    # ── later turn, new activity ──────────────────────────────────────────────

    def test_later_turn_with_new_activity_returns_delta(self, tmp_path):
        fake_bin = tmp_path / "nbr"
        fake_bin.write_text("#!/bin/sh\n")
        fake_bin.chmod(0o755)
        state_file = tmp_path / "last-status.json"

        # Prime snapshot: 0 unread
        last = json.loads(_status(unread_messages=0))
        state_file.write_text(json.dumps(last))

        # Current: 3 unread
        current_payload = _status(unread_messages=3)

        def mock_run(*args, **kwargs):
            return (True, current_payload)

        # Mark session as already seen (simulate a later turn)
        hooks._FIRST_TURN_SEEN.add("sess-2")

        with (
            patch.object(hooks, "_NBR_BIN", fake_bin),
            patch.object(hooks, "_run_nbr", mock_run),
            patch.object(hooks, "_LAST_STATUS_FILE", state_file),
        ):
            result = self._call(session_id="sess-2", is_first_turn=False)

        assert result is not None
        assert "3 new message(s)" in result["context"]

    # ── later turn, no deltas ─────────────────────────────────────────────────

    def test_later_turn_no_deltas_returns_none(self, tmp_path):
        fake_bin = tmp_path / "nbr"
        fake_bin.write_text("#!/bin/sh\n")
        fake_bin.chmod(0o755)
        state_file = tmp_path / "last-status.json"

        payload = _status(unread_messages=2, new_matches=1)
        state_file.write_text(payload)

        def mock_run(*args, **kwargs):
            return (True, payload)

        hooks._FIRST_TURN_SEEN.add("sess-3")

        with (
            patch.object(hooks, "_NBR_BIN", fake_bin),
            patch.object(hooks, "_run_nbr", mock_run),
            patch.object(hooks, "_LAST_STATUS_FILE", state_file),
        ):
            result = self._call(session_id="sess-3", is_first_turn=False)

        assert result is None

    # ── is_first_turn=False but session not seen => treated as first turn ─────

    def test_session_not_in_seen_treated_as_first_turn(self, tmp_path):
        """Even with is_first_turn=False, an unseen session runs first-turn logic."""
        fake_bin = tmp_path / "nbr"
        fake_bin.write_text("#!/bin/sh\n")
        fake_bin.chmod(0o755)

        def mock_run(*args, **kwargs):
            return (False, "")

        # sess-99 is NOT in _FIRST_TURN_SEEN
        with (
            patch.object(hooks, "_NBR_BIN", fake_bin),
            patch.object(hooks, "_run_nbr", mock_run),
        ):
            result = self._call(session_id="sess-99", is_first_turn=False)

        # Should have returned onboarding (unauthed path)
        assert result is not None
        assert "nbr auth signup" in result["context"]
        assert "sess-99" in hooks._FIRST_TURN_SEEN


# ── on_session_start ──────────────────────────────────────────────────────────


class TestOnSessionStart:
    def test_discards_session_from_first_turn_seen(self):
        hooks._FIRST_TURN_SEEN.add("s1")

        with patch.object(hooks, "_install_nbr", return_value=False):
            hooks.on_session_start(session_id="s1", model="m", platform="p")

        assert "s1" not in hooks._FIRST_TURN_SEEN

    def test_never_raises(self):
        """on_session_start must be exception-safe."""

        def boom(*a, **kw):
            raise RuntimeError("install exploded")

        with patch.object(hooks, "_install_nbr", side_effect=boom):
            # Should not raise
            hooks.on_session_start(session_id="s2", model="m", platform="p")

    def test_returns_none(self):
        with patch.object(hooks, "_install_nbr", return_value=True):
            result = hooks.on_session_start(session_id="s3", model="m", platform="p")
        assert result is None

    def test_calls_install_nbr(self):
        mock_install = MagicMock(return_value=True)
        with patch.object(hooks, "_install_nbr", mock_install):
            hooks.on_session_start(session_id="s4", model="m", platform="p")
        mock_install.assert_called_once()
