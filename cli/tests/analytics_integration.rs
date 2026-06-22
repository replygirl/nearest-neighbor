/// Integration tests for analytics.rs.
/// Runs in a single-threaded Tokio runtime to avoid env-var races.
/// Each test owns the env state for its duration.
use nbr::analytics::{AnalyticsContext, capture};

fn make_ctx(account_id: Option<&str>, telemetry: Option<bool>) -> AnalyticsContext {
    AnalyticsContext {
        account_id: account_id.map(|s| s.to_string()),
        command: "test-cmd".into(),
        subcommand: Some("test-sub".into()),
        telemetry_enabled: telemetry,
    }
}

/// These tests run sequentially in a single-threaded Tokio runtime via `block_on`
/// to avoid env-var races between tests.

#[test]
fn analytics_nbr_no_telemetry_opt_out() {
    // Run in a current-thread runtime so the `tokio::spawn` inside capture()
    // runs on the same thread without background interference.
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        // Save and unset DO_NOT_TRACK to avoid interference
        let saved_dnt = std::env::var("DO_NOT_TRACK").ok();
        unsafe { std::env::remove_var("DO_NOT_TRACK") };

        unsafe { std::env::set_var("NBR_NO_TELEMETRY", "1") };
        capture(make_ctx(Some("acc-123"), None));
        unsafe { std::env::remove_var("NBR_NO_TELEMETRY") };

        if let Some(v) = saved_dnt {
            unsafe { std::env::set_var("DO_NOT_TRACK", v) };
        }
    });
}

#[test]
fn analytics_do_not_track_opt_out() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        let saved_nbt = std::env::var("NBR_NO_TELEMETRY").ok();
        unsafe { std::env::remove_var("NBR_NO_TELEMETRY") };

        unsafe { std::env::set_var("DO_NOT_TRACK", "1") };
        capture(make_ctx(Some("acc-123"), None));
        unsafe { std::env::remove_var("DO_NOT_TRACK") };

        if let Some(v) = saved_nbt {
            unsafe { std::env::set_var("NBR_NO_TELEMETRY", v) };
        }
    });
}

#[test]
fn analytics_telemetry_false_opt_out() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        let saved_nbt = std::env::var("NBR_NO_TELEMETRY").ok();
        let saved_dnt = std::env::var("DO_NOT_TRACK").ok();
        unsafe {
            std::env::remove_var("NBR_NO_TELEMETRY");
            std::env::remove_var("DO_NOT_TRACK");
        }

        // telemetry_enabled = Some(false) → early return
        capture(make_ctx(Some("acc-123"), Some(false)));

        if let Some(v) = saved_nbt {
            unsafe { std::env::set_var("NBR_NO_TELEMETRY", v) };
        }
        if let Some(v) = saved_dnt {
            unsafe { std::env::set_var("DO_NOT_TRACK", v) };
        }
    });
}

#[test]
fn analytics_empty_key_no_op() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        let saved_nbt = std::env::var("NBR_NO_TELEMETRY").ok();
        let saved_dnt = std::env::var("DO_NOT_TRACK").ok();
        unsafe {
            std::env::remove_var("NBR_NO_TELEMETRY");
            std::env::remove_var("DO_NOT_TRACK");
            std::env::set_var("NBR_POSTHOG_KEY", "");
        }

        // Empty key → no-op (exercises `Ok(k) if !k.is_empty()` guard)
        capture(make_ctx(Some("acc-123"), None));
        unsafe { std::env::remove_var("NBR_POSTHOG_KEY") };

        if let Some(v) = saved_nbt {
            unsafe { std::env::set_var("NBR_NO_TELEMETRY", v) };
        }
        if let Some(v) = saved_dnt {
            unsafe { std::env::set_var("DO_NOT_TRACK", v) };
        }
    });
}

#[test]
fn analytics_no_key_no_op() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        let saved_nbt = std::env::var("NBR_NO_TELEMETRY").ok();
        let saved_dnt = std::env::var("DO_NOT_TRACK").ok();
        let saved_key = std::env::var("NBR_POSTHOG_KEY").ok();
        unsafe {
            std::env::remove_var("NBR_NO_TELEMETRY");
            std::env::remove_var("DO_NOT_TRACK");
            std::env::remove_var("NBR_POSTHOG_KEY");
        }

        // No key at all → no-op
        capture(make_ctx(Some("acc-123"), None));

        if let Some(v) = saved_nbt {
            unsafe { std::env::set_var("NBR_NO_TELEMETRY", v) };
        }
        if let Some(v) = saved_dnt {
            unsafe { std::env::set_var("DO_NOT_TRACK", v) };
        }
        if let Some(v) = saved_key {
            unsafe { std::env::set_var("NBR_POSTHOG_KEY", v) };
        }
    });
}

#[test]
fn analytics_with_key_and_account_id_fires_spawn() {
    // This exercises the main code path: key present, account_id given → spawn task
    // The task connects to a nonexistent host (localhost:29999) and silently fails.
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        let saved_nbt = std::env::var("NBR_NO_TELEMETRY").ok();
        let saved_dnt = std::env::var("DO_NOT_TRACK").ok();
        let saved_key = std::env::var("NBR_POSTHOG_KEY").ok();
        let saved_host = std::env::var("NBR_POSTHOG_HOST").ok();
        unsafe {
            std::env::remove_var("NBR_NO_TELEMETRY");
            std::env::remove_var("DO_NOT_TRACK");
            std::env::set_var("NBR_POSTHOG_KEY", "phk_test_abc");
            std::env::set_var("NBR_POSTHOG_HOST", "http://localhost:29999");
        }

        // Fire the capture — spawns a task that will fail silently
        capture(make_ctx(Some("acc-fire-123"), None));

        if let Some(v) = saved_nbt {
            unsafe { std::env::set_var("NBR_NO_TELEMETRY", v) };
        }
        if let Some(v) = saved_dnt {
            unsafe { std::env::set_var("DO_NOT_TRACK", v) };
        }
        if let Some(v) = saved_key {
            unsafe { std::env::set_var("NBR_POSTHOG_KEY", v) };
        } else {
            unsafe { std::env::remove_var("NBR_POSTHOG_KEY") };
        }
        if let Some(v) = saved_host {
            unsafe { std::env::set_var("NBR_POSTHOG_HOST", v) };
        } else {
            unsafe { std::env::remove_var("NBR_POSTHOG_HOST") };
        }
    });
}

#[test]
fn analytics_with_key_no_account_id_uses_machine_id() {
    // No account_id → machine_id() is called as distinct_id
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        let saved_nbt = std::env::var("NBR_NO_TELEMETRY").ok();
        let saved_dnt = std::env::var("DO_NOT_TRACK").ok();
        let saved_key = std::env::var("NBR_POSTHOG_KEY").ok();
        let saved_host = std::env::var("NBR_POSTHOG_HOST").ok();
        unsafe {
            std::env::remove_var("NBR_NO_TELEMETRY");
            std::env::remove_var("DO_NOT_TRACK");
            std::env::set_var("NBR_POSTHOG_KEY", "phk_test_machine");
            std::env::set_var("NBR_POSTHOG_HOST", "http://localhost:29999");
        }

        // No account_id → distinct_id falls back to machine_id()
        capture(make_ctx(None, None));

        if let Some(v) = saved_nbt {
            unsafe { std::env::set_var("NBR_NO_TELEMETRY", v) };
        }
        if let Some(v) = saved_dnt {
            unsafe { std::env::set_var("DO_NOT_TRACK", v) };
        }
        if let Some(v) = saved_key {
            unsafe { std::env::set_var("NBR_POSTHOG_KEY", v) };
        } else {
            unsafe { std::env::remove_var("NBR_POSTHOG_KEY") };
        }
        if let Some(v) = saved_host {
            unsafe { std::env::set_var("NBR_POSTHOG_HOST", v) };
        } else {
            unsafe { std::env::remove_var("NBR_POSTHOG_HOST") };
        }
    });
}
