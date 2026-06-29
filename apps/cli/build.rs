//! Resolves the version baked into the `nbr` binary.
//!
//! Priority:
//!   1. `NBR_RELEASE_VERSION` — set by the CLI release workflow to the published
//!      git tag (e.g. `v1.0.1`); the leading `v` is stripped. This is the source
//!      of truth for released binaries: the platform version lives in the git
//!      tag, not in Cargo.toml.
//!   2. `CARGO_PKG_VERSION` — the Cargo.toml version, used for local/dev builds.
//!
//! The result is exposed as the `NBR_VERSION` compile-time env var, consumed by
//! `clap` (`--version`), the HTTP User-Agent, and analytics events.

fn main() {
    let version = std::env::var("NBR_RELEASE_VERSION")
        .ok()
        .map(|v| v.trim().trim_start_matches('v').to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| std::env::var("CARGO_PKG_VERSION").unwrap());

    println!("cargo:rustc-env=NBR_VERSION={version}");
    println!("cargo:rerun-if-env-changed=NBR_RELEASE_VERSION");
}
