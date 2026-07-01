//! `nbr self-update` — replace the running `nbr` binary with a newer release.
//!
//! This command is auth-free: it never builds an API client or reads a token. It
//! is wired into the pre-resolve block of [`crate::run`] so it works even when no
//! account is configured.
//!
//! Flow:
//!   1. Enumerate ALL releases (including prereleases) via `self_update`'s
//!      `ReleaseList`. GitHub's `/releases/latest` only returns stable releases,
//!      but the shell installers (and therefore this command) treat prereleases
//!      as real releases, so we list everything and pick the newest by release
//!      order — mirroring the installers.
//!   2. Select the target release (newest, or the one matching `--version`).
//!   3. Fetch the release's `SHA256SUMS` asset and extract the digest for our
//!      platform archive, so the download can be checksum-verified before it ever
//!      replaces the running binary.
//!   4. Hand the tag + digest to `self_update`'s high-level `Update` flow, which
//!      downloads, verifies the checksum, extracts, and atomically swaps the
//!      binary.
//!
//! Concurrency note: `self_update`'s blocking backend spins up its own runtime,
//! which panics if called from within tokio's async context ("Cannot start a
//! runtime from within a runtime"). All blocking `self_update` work therefore
//! runs inside [`tokio::task::spawn_blocking`]. The `SHA256SUMS` fetch uses this
//! crate's own async `reqwest` client and stays on the async side.

use anyhow::{Context, Result};

use crate::error::NbrError;

const REPO_OWNER: &str = "replygirl";
const REPO_NAME: &str = "nearest-neighbor";
const BIN_NAME: &str = "nbr";

/// Archive file extension for release assets.
///
/// Per the confirmed design, `self_update` is built with the `archive-tar` +
/// `compression-flate2` (gzip) features, so this targets `.tar.gz` assets.
const ARCHIVE_EXT: &str = "tar.gz";

/// Release asset filename for a given target triple, e.g.
/// `nbr-x86_64-unknown-linux-musl.tar.gz`. Used to locate the matching line in
/// the release's `SHA256SUMS` file.
pub fn asset_name(target: &str) -> String {
    format!("{BIN_NAME}-{target}.{ARCHIVE_EXT}")
}

/// Path of the binary inside the release archive, e.g.
/// `nbr-x86_64-unknown-linux-musl/nbr`. The release pipeline stages the binary
/// in a `nbr-<triple>/` subdirectory, so `self_update` needs this hint to find
/// it after extraction.
pub fn bin_path_in_archive(target: &str) -> String {
    format!("{BIN_NAME}-{target}/{BIN_NAME}")
}

/// Reconstruct the git tag for a release. The repository tags every release as
/// `v<semver>` and `self_update` exposes only the `v`-stripped semver in
/// [`self_update::Release::version`], so we re-add the prefix.
pub fn tag_for(version: &str) -> String {
    format!("v{version}")
}

/// Base URL under which GitHub serves a release's downloadable assets. The
/// `SHA256SUMS` (and archive) files live at `{base}/{tag}/<name>`. Split out as a
/// constant so tests can point the checksum fetch at a mock server.
const GH_DOWNLOAD_BASE: &str = "https://github.com/replygirl/nearest-neighbor/releases/download";

/// URL of a release's `SHA256SUMS` asset, given a download base and tag.
pub fn sha256sums_url(base: &str, tag: &str) -> String {
    format!("{base}/{tag}/SHA256SUMS")
}

/// Whether `latest` is a strictly newer semver than `current`.
///
/// Returns `false` if either version fails to parse as semver (treating an
/// unparseable pair as "no update available" rather than erroring the command).
pub fn needs_update(current: &str, latest: &str) -> bool {
    self_update::version::bump_is_greater(current, latest).unwrap_or(false)
}

/// Select the target release from the fetched list.
///
/// - `requested = Some(tag)` selects the release whose version matches `tag`
///   (with or without a leading `v`); errors if no such release exists.
/// - `requested = None` selects the newest release. `ReleaseList::fetch` returns
///   releases in GitHub's newest-first order and performs no prerelease
///   filtering, so the first element is the newest release overall — prereleases
///   included.
pub fn select_release(
    releases: &[self_update::Release],
    requested: Option<&str>,
) -> Result<self_update::Release> {
    if releases.is_empty() {
        return Err(
            NbrError::Other(format!("no releases found for {REPO_OWNER}/{REPO_NAME}")).into(),
        );
    }
    match requested {
        Some(req) => {
            let want = req.trim_start_matches('v');
            releases
                .iter()
                .find(|r| r.version == want)
                .cloned()
                .ok_or_else(|| NbrError::Other(format!("release `{req}` not found")).into())
        }
        None => Ok(releases[0].clone()),
    }
}

/// Extract the SHA-256 digest for `asset` from the contents of a `SHA256SUMS`
/// file (the `sha256sum` output format: `<hex>␠␠<filename>`). A leading `*`
/// binary-mode marker on the filename is tolerated. The returned digest is
/// lowercased hex.
pub fn parse_sha256(sums: &str, asset: &str) -> Result<String> {
    for line in sums.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let (Some(hash), Some(name)) = (parts.next(), parts.next()) else {
            continue;
        };
        let name = name.trim_start_matches('*');
        if name == asset {
            return Ok(hash.to_lowercase());
        }
    }
    Err(NbrError::Other(format!("checksum for `{asset}` not found in SHA256SUMS")).into())
}

/// Fetch a URL as text using this crate's async `reqwest` client.
///
/// GitHub rejects requests without a User-Agent, so one is always sent. Network
/// and non-2xx responses propagate as [`NbrError::Network`].
async fn fetch_text(url: &str) -> Result<String> {
    let resp = reqwest::Client::new()
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            format!("{BIN_NAME}/{}", env!("NBR_VERSION")),
        )
        .send()
        .await
        .map_err(NbrError::Network)?
        .error_for_status()
        .map_err(NbrError::Network)?;
    let body = resp.text().await.map_err(NbrError::Network)?;
    Ok(body)
}

/// Blocking: enumerate all GitHub releases (including prereleases).
fn fetch_releases() -> Result<Vec<self_update::Release>> {
    let releases = self_update::backends::github::ReleaseList::configure()
        .repo_owner(REPO_OWNER)
        .repo_name(REPO_NAME)
        .build()
        .context("failed to configure release list")?
        .fetch()
        .context("failed to list releases")?;
    Ok(releases)
}

/// Everything a binary swap needs once the decision to update has been made.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateJob {
    pub tag: String,
    pub current: String,
    pub target: String,
    pub digest: String,
}

/// Blocking: download, verify, and install the release described by `job`. This
/// is the thin, genuinely-untestable self-replacement glue — it actually swaps
/// the running binary, so it is exercised only end-to-end, not in unit tests.
fn perform_update(job: UpdateJob, show_progress: bool) -> Result<self_update::VersionStatus> {
    let status = self_update::backends::github::Update::configure()
        .repo_owner(REPO_OWNER)
        .repo_name(REPO_NAME)
        .bin_name(BIN_NAME)
        .target(&job.target)
        .release_tag(&job.tag)
        .current_version(&job.current)
        .bin_path_in_archive(bin_path_in_archive(&job.target))
        .verify_checksum(self_update::Checksum::Sha256(job.digest))
        .show_download_progress(show_progress)
        .show_output(false)
        .no_confirm(true)
        .build()
        .context("failed to configure update")?
        .update()
        .context("update failed")?;
    Ok(status)
}

/// Decide what to do for a fetched release list and, for the update path, fetch
/// and verify the checksum — returning the [`UpdateJob`] to execute.
///
/// This holds all the branch logic and I/O *except* the two genuinely
/// untestable pieces (release enumeration and the binary swap), so it is unit
/// tested end-to-end against built releases and a mock `SHA256SUMS` server.
///
/// Returns `Ok(None)` for the `--check` dry run and the already-up-to-date case
/// (both of which print their own report); `Ok(Some(job))` when the caller should
/// proceed with the swap.
async fn plan_update(
    current: &str,
    target: &str,
    releases: &[self_update::Release],
    json: bool,
    check: bool,
    version: Option<&str>,
    download_base: &str,
) -> Result<Option<UpdateJob>> {
    let chosen = select_release(releases, version)?;
    let latest = chosen.version;
    let tag = tag_for(&latest);
    let available = needs_update(current, &latest);

    // --check: report and stop without installing anything.
    if check {
        report_check(json, current, &latest, &tag, available);
        return Ok(None);
    }

    // Already current and no explicit tag requested → nothing to do. An explicit
    // --version always proceeds (allows reinstall / pinning to an older tag).
    if !available && version.is_none() {
        report_up_to_date(json, current);
        return Ok(None);
    }

    // Fetch + parse the checksum for our platform archive before any swap.
    let asset = asset_name(target);
    let sums = fetch_text(&sha256sums_url(download_base, &tag)).await?;
    let digest = parse_sha256(&sums, &asset)?;

    Ok(Some(UpdateJob {
        tag,
        current: current.to_string(),
        target: target.to_string(),
        digest,
    }))
}

/// Entry point for `nbr self-update`.
///
/// `check` performs a dry run (report only); `version` pins a specific release
/// tag. Honors the global `--json` flag. Delegates to [`run_self_update_with`]
/// with the real release-enumeration and binary-swap implementations.
pub async fn run_self_update(json: bool, check: bool, version: Option<String>) -> Result<()> {
    run_self_update_with(
        json,
        check,
        version,
        GH_DOWNLOAD_BASE,
        fetch_releases,
        perform_update,
    )
    .await
}

/// Orchestrate a self-update, with the two genuinely-untestable I/O operations
/// — release enumeration (`fetch`) and the binary swap (`do_update`) — injected.
///
/// The public [`run_self_update`] passes the real network/swap implementations;
/// tests pass stubs so the wiring (release fetch → analytics flush → decision →
/// swap → report) is exercised without touching GitHub or the filesystem.
async fn run_self_update_with<F, U>(
    json: bool,
    check: bool,
    version: Option<String>,
    download_base: &str,
    fetch: F,
    do_update: U,
) -> Result<()>
where
    F: FnOnce() -> Result<Vec<self_update::Release>> + Send + 'static,
    U: FnOnce(UpdateJob, bool) -> Result<self_update::VersionStatus> + Send + 'static,
{
    let current = env!("NBR_VERSION").to_string();
    let target = self_update::get_target().to_string();

    // 1. Enumerate releases (blocking → spawn_blocking).
    let releases = tokio::task::spawn_blocking(fetch)
        .await
        .context("release-list task panicked")??;

    // 2. Capture AND flush analytics BEFORE any binary swap — a fire-and-forget
    // spawn would be killed when the process image is replaced. Telemetry
    // preference is loaded best-effort (config load needs no auth).
    let telemetry = crate::config::load_config().ok().and_then(|c| c.telemetry);
    crate::analytics::capture_and_flush(crate::analytics::AnalyticsContext {
        account_id: None,
        command: "self-update".into(),
        subcommand: None,
        telemetry_enabled: telemetry,
    })
    .await;

    // 3. Decide + fetch/verify checksum. `None` means the report has already been
    // printed (check / up-to-date) and there is nothing to install.
    let Some(job) = plan_update(
        &current,
        &target,
        &releases,
        json,
        check,
        version.as_deref(),
        download_base,
    )
    .await?
    else {
        return Ok(());
    };

    // 4. Download, verify, and swap the binary (blocking → spawn_blocking).
    let status = tokio::task::spawn_blocking(move || do_update(job, !json))
        .await
        .context("update task panicked")??;

    report_result(json, &status);
    Ok(())
}

/// Render the `--check` dry-run result.
fn report_check(json: bool, current: &str, latest: &str, tag: &str, available: bool) {
    if json {
        crate::output::print_json(&serde_json::json!({
            "current": current,
            "latest": latest,
            "tag": tag,
            "update_available": available,
        }));
    } else {
        crate::output::print_kv(&[
            ("current", current.to_string()),
            ("latest", latest.to_string()),
            ("tag", tag.to_string()),
            ("update_available", available.to_string()),
        ]);
    }
}

/// Render the "already up to date" result.
fn report_up_to_date(json: bool, current: &str) {
    if json {
        crate::output::print_json(&serde_json::json!({
            "status": "up_to_date",
            "current": current,
        }));
    } else {
        crate::output::print_success(&format!("nbr is up to date (v{current})"));
    }
}

/// Render the outcome of an applied update.
fn report_result(json: bool, status: &self_update::VersionStatus) {
    match status {
        self_update::VersionStatus::Updated(v) => {
            if json {
                crate::output::print_json(&serde_json::json!({
                    "status": "updated",
                    "version": v,
                }));
            } else {
                crate::output::print_success(&format!("Updated nbr to v{v}"));
            }
        }
        // `VersionStatus` is #[non_exhaustive]; the up-to-date rendering is the
        // safe default for `UpToDate` and any future variant alike.
        other => {
            report_up_to_date(json, other.version());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use self_update::{Release, ReleaseAsset};

    fn release(version: &str) -> Release {
        Release::builder().version(version).build().unwrap()
    }

    // ── asset_name / bin_path_in_archive / tag_for / sha256sums_url ────────────

    #[test]
    fn asset_name_uses_triple_and_ext() {
        assert_eq!(
            asset_name("x86_64-unknown-linux-musl"),
            "nbr-x86_64-unknown-linux-musl.tar.gz"
        );
    }

    #[test]
    fn bin_path_in_archive_nests_under_triple_dir() {
        assert_eq!(
            bin_path_in_archive("aarch64-apple-darwin"),
            "nbr-aarch64-apple-darwin/nbr"
        );
    }

    #[test]
    fn tag_for_prefixes_v() {
        assert_eq!(tag_for("1.2.3"), "v1.2.3");
        assert_eq!(tag_for("1.0.0-rc.1"), "v1.0.0-rc.1");
    }

    #[test]
    fn sha256sums_url_points_at_release_download() {
        assert_eq!(
            sha256sums_url(GH_DOWNLOAD_BASE, "v1.2.3"),
            "https://github.com/replygirl/nearest-neighbor/releases/download/v1.2.3/SHA256SUMS"
        );
    }

    // ── needs_update ──────────────────────────────────────────────────────────

    #[test]
    fn needs_update_true_when_latest_greater() {
        assert!(needs_update("1.0.0", "1.0.1"));
        assert!(needs_update("1.0.0", "2.0.0"));
    }

    #[test]
    fn needs_update_false_when_equal_or_older() {
        assert!(!needs_update("1.0.0", "1.0.0"));
        assert!(!needs_update("1.0.1", "1.0.0"));
    }

    #[test]
    fn needs_update_false_on_unparseable_version() {
        assert!(!needs_update("not-semver", "1.0.0"));
        assert!(!needs_update("1.0.0", "not-semver"));
    }

    #[test]
    fn needs_update_handles_prerelease() {
        // a stable release is newer than its own prerelease
        assert!(needs_update("1.0.0-rc.1", "1.0.0"));
        assert!(!needs_update("1.0.0", "1.0.0-rc.1"));
    }

    // ── select_release ────────────────────────────────────────────────────────

    #[test]
    fn select_release_empty_errors() {
        let err = select_release(&[], None).unwrap_err();
        assert!(err.to_string().contains("no releases found"));
    }

    #[test]
    fn select_release_none_picks_first_newest() {
        // GitHub returns newest-first; we pick index 0 even when it is a
        // prerelease ranked ahead of an older stable release.
        let releases = vec![release("2.0.0-rc.1"), release("1.9.0"), release("1.8.0")];
        let chosen = select_release(&releases, None).unwrap();
        assert_eq!(chosen.version, "2.0.0-rc.1");
    }

    #[test]
    fn select_release_requested_matches_with_v_prefix() {
        let releases = vec![release("2.0.0"), release("1.9.0")];
        let chosen = select_release(&releases, Some("v1.9.0")).unwrap();
        assert_eq!(chosen.version, "1.9.0");
    }

    #[test]
    fn select_release_requested_matches_without_v_prefix() {
        let releases = vec![release("2.0.0"), release("1.9.0")];
        let chosen = select_release(&releases, Some("1.9.0")).unwrap();
        assert_eq!(chosen.version, "1.9.0");
    }

    #[test]
    fn select_release_requested_missing_errors() {
        let releases = vec![release("2.0.0"), release("1.9.0")];
        let err = select_release(&releases, Some("v3.0.0")).unwrap_err();
        assert!(err.to_string().contains("v3.0.0"));
        assert!(err.to_string().contains("not found"));
    }

    // ── parse_sha256 ──────────────────────────────────────────────────────────

    fn sums_fixture() -> String {
        // Mirrors `sha256sum` output: two-space separator, one line per asset.
        [
            "1111111111111111111111111111111111111111111111111111111111111111  nbr-x86_64-unknown-linux-musl.tar.gz",
            "2222222222222222222222222222222222222222222222222222222222222222  nbr-aarch64-apple-darwin.tar.gz",
            "3333333333333333333333333333333333333333333333333333333333333333  nbr-x86_64-pc-windows-msvc.zip",
        ]
        .join("\n")
    }

    #[test]
    fn parse_sha256_finds_matching_asset() {
        let digest = parse_sha256(&sums_fixture(), "nbr-aarch64-apple-darwin.tar.gz").unwrap();
        assert_eq!(
            digest,
            "2222222222222222222222222222222222222222222222222222222222222222"
        );
    }

    #[test]
    fn parse_sha256_missing_asset_errors() {
        let err = parse_sha256(&sums_fixture(), "nbr-does-not-exist.tar.gz").unwrap_err();
        assert!(err.to_string().contains("not found in SHA256SUMS"));
    }

    #[test]
    fn parse_sha256_lowercases_and_tolerates_binary_marker() {
        let sums = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789 *nbr-x86_64-unknown-linux-musl.tar.gz";
        let digest = parse_sha256(sums, "nbr-x86_64-unknown-linux-musl.tar.gz").unwrap();
        assert_eq!(
            digest,
            "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
        );
    }

    #[test]
    fn parse_sha256_skips_blank_and_malformed_lines() {
        let sums = format!(
            "\n   \nmalformed-line-without-two-fields\n{}",
            "4444444444444444444444444444444444444444444444444444444444444444  nbr-target.tar.gz"
        );
        let digest = parse_sha256(&sums, "nbr-target.tar.gz").unwrap();
        assert_eq!(
            digest,
            "4444444444444444444444444444444444444444444444444444444444444444"
        );
    }

    // ── ReleaseAsset constructibility (used indirectly by selection) ────────────

    #[test]
    fn release_can_carry_assets() {
        let rel = Release::builder()
            .version("1.0.0")
            .asset(ReleaseAsset::new(
                "nbr-x86_64-unknown-linux-musl.tar.gz",
                "https://example.com/a",
            ))
            .build()
            .unwrap();
        assert!(rel.has_target_asset("x86_64-unknown-linux-musl"));
    }

    // ── fetch_text (HTTP) ───────────────────────────────────────────────────────

    #[tokio::test]
    async fn fetch_text_returns_body_on_success() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let body = "deadbeef  nbr-x86_64-unknown-linux-musl.tar.gz\n";
        Mock::given(method("GET"))
            .and(path("/SHA256SUMS"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;

        let got = fetch_text(&format!("{}/SHA256SUMS", server.uri()))
            .await
            .unwrap();
        assert_eq!(got, body);
    }

    #[tokio::test]
    async fn fetch_text_errors_on_non_2xx() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/SHA256SUMS"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let err = fetch_text(&format!("{}/SHA256SUMS", server.uri()))
            .await
            .unwrap_err();
        // error_for_status() surfaces the 404 as a network error
        assert!(err.downcast_ref::<NbrError>().is_some());
    }

    #[tokio::test]
    async fn fetch_text_errors_on_connection_failure() {
        // Port 19998 is almost certainly closed → connection error propagates.
        let err = fetch_text("http://127.0.0.1:19998/SHA256SUMS")
            .await
            .unwrap_err();
        assert!(err.downcast_ref::<NbrError>().is_some());
    }

    // ── report_* (output rendering) ──────────────────────────────────────────────

    #[test]
    fn report_check_human_and_json_do_not_panic() {
        report_check(false, "1.0.0", "1.0.1", "v1.0.1", true);
        report_check(true, "1.0.0", "1.0.1", "v1.0.1", true);
    }

    #[test]
    fn report_up_to_date_human_and_json_do_not_panic() {
        report_up_to_date(false, "1.0.0");
        report_up_to_date(true, "1.0.0");
    }

    #[test]
    fn report_result_updated_human_and_json_do_not_panic() {
        let status = self_update::VersionStatus::Updated("1.0.1".into());
        report_result(false, &status);
        report_result(true, &status);
    }

    #[test]
    fn report_result_up_to_date_human_and_json_do_not_panic() {
        let status = self_update::VersionStatus::UpToDate("1.0.0".into());
        report_result(false, &status);
        report_result(true, &status);
    }

    // ── plan_update (decision + checksum integration) ────────────────────────────

    const TEST_TARGET: &str = "x86_64-unknown-linux-musl";

    fn test_asset_digest() -> (String, String) {
        (format!("nbr-{TEST_TARGET}.tar.gz"), "5".repeat(64))
    }

    async fn mock_sums_server(tag: &str) -> wiremock::MockServer {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let (asset, digest) = test_asset_digest();
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(format!("/{tag}/SHA256SUMS")))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(format!("{digest}  {asset}\n")),
            )
            .mount(&server)
            .await;
        server
    }

    #[tokio::test]
    async fn plan_update_check_returns_none_without_network() {
        // check=true → dry run, returns None, never touches the (unset) base URL.
        let releases = vec![release("9.9.9")];
        let plan = plan_update(
            "1.0.0",
            TEST_TARGET,
            &releases,
            false,
            true,
            None,
            "http://127.0.0.1:1", // must not be contacted
        )
        .await
        .unwrap();
        assert!(plan.is_none());
    }

    #[tokio::test]
    async fn plan_update_up_to_date_returns_none() {
        let releases = vec![release("1.0.0")];
        let plan = plan_update(
            "1.0.0",
            TEST_TARGET,
            &releases,
            false,
            false,
            None,
            "http://127.0.0.1:1",
        )
        .await
        .unwrap();
        assert!(plan.is_none());
    }

    #[tokio::test]
    async fn plan_update_newer_release_returns_job_with_checksum() {
        let server = mock_sums_server("v9.9.9").await;
        let releases = vec![release("9.9.9"), release("1.0.0")];
        let job = plan_update(
            "1.0.0",
            TEST_TARGET,
            &releases,
            false,
            false,
            None,
            &server.uri(),
        )
        .await
        .unwrap()
        .expect("an update should be planned");

        let (_, digest) = test_asset_digest();
        assert_eq!(job.tag, "v9.9.9");
        assert_eq!(job.current, "1.0.0");
        assert_eq!(job.target, TEST_TARGET);
        assert_eq!(job.digest, digest);
    }

    #[tokio::test]
    async fn plan_update_explicit_version_proceeds_even_when_not_newer() {
        // Requesting the current version (not "newer") still proceeds — allows
        // reinstall / pinning. Mock the SHA256SUMS for that tag.
        let server = mock_sums_server("v1.0.0").await;
        let releases = vec![release("9.9.9"), release("1.0.0")];
        let job = plan_update(
            "1.0.0",
            TEST_TARGET,
            &releases,
            true, // json mode for variety
            false,
            Some("v1.0.0"),
            &server.uri(),
        )
        .await
        .unwrap()
        .expect("explicit --version should plan an update");
        assert_eq!(job.tag, "v1.0.0");
    }

    #[tokio::test]
    async fn plan_update_missing_checksum_errors() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        // Server returns a SHA256SUMS that does not list our asset.
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v9.9.9/SHA256SUMS"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string("0000  nbr-some-other-target.tar.gz\n"),
            )
            .mount(&server)
            .await;

        let releases = vec![release("9.9.9")];
        let err = plan_update(
            "1.0.0",
            TEST_TARGET,
            &releases,
            false,
            false,
            None,
            &server.uri(),
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("not found in SHA256SUMS"));
    }

    #[tokio::test]
    async fn plan_update_no_releases_errors() {
        let err = plan_update(
            "1.0.0",
            TEST_TARGET,
            &[],
            false,
            false,
            None,
            "http://127.0.0.1:1",
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("no releases found"));
    }

    // ── run_self_update_with (orchestration wiring) ──────────────────────────────
    //
    // These inject stub `fetch` (release enumeration) and `do_update` (binary
    // swap) closures so the wiring is exercised without touching GitHub or the
    // filesystem. `env!("NBR_VERSION")` is "0.1.0" in dev builds, so a "9.9.9"
    // release is treated as newer and a "0.1.0" release as up-to-date.

    /// `--check`: enumerates releases, flushes analytics, prints the report, and
    /// never invokes the swap.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn run_self_update_with_check_does_not_swap() {
        let called = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = called.clone();
        run_self_update_with(
            false,
            true, // check
            None,
            "http://127.0.0.1:1", // must not be contacted
            || Ok(vec![release("9.9.9")]),
            move |_job, _show| {
                flag.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(self_update::VersionStatus::Updated("9.9.9".into()))
            },
        )
        .await
        .unwrap();
        assert!(
            !called.load(std::sync::atomic::Ordering::SeqCst),
            "--check must not perform the swap"
        );
    }

    /// Up-to-date: newest release equals the current version → no swap.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn run_self_update_with_up_to_date_does_not_swap() {
        let called = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = called.clone();
        run_self_update_with(
            true, // json
            false,
            None,
            "http://127.0.0.1:1",
            || Ok(vec![release(env!("NBR_VERSION"))]),
            move |_job, _show| {
                flag.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(self_update::VersionStatus::Updated("x".into()))
            },
        )
        .await
        .unwrap();
        assert!(
            !called.load(std::sync::atomic::Ordering::SeqCst),
            "up-to-date must not perform the swap"
        );
    }

    /// Proceed: a newer release drives checksum fetch (mock) + the swap stub, and
    /// the result is reported.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn run_self_update_with_proceeds_and_swaps() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        // The orchestrator resolves the asset for the real host triple, so the
        // mock SHA256SUMS must list that triple.
        let host_asset = asset_name(self_update::get_target());
        let digest = "5".repeat(64);
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v9.9.9/SHA256SUMS"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(format!("{digest}  {host_asset}\n")),
            )
            .mount(&server)
            .await;

        let called = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = called.clone();
        let expected_digest = digest.clone();

        run_self_update_with(
            false,
            false,
            None,
            &server.uri(),
            || Ok(vec![release("9.9.9")]),
            move |job, _show| {
                // The job carries the checksum parsed from the mock SHA256SUMS.
                assert_eq!(job.tag, "v9.9.9");
                assert_eq!(job.digest, expected_digest);
                flag.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(self_update::VersionStatus::Updated("9.9.9".into()))
            },
        )
        .await
        .unwrap();
        assert!(
            called.load(std::sync::atomic::Ordering::SeqCst),
            "an available update must perform the swap"
        );
    }

    /// A panic inside the release-enumeration task surfaces as an error rather
    /// than unwinding the caller.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn run_self_update_with_fetch_error_propagates() {
        let err = run_self_update_with(
            false,
            true,
            None,
            "http://127.0.0.1:1",
            || Err(NbrError::Other("boom".into()).into()),
            |_job, _show| Ok(self_update::VersionStatus::UpToDate("x".into())),
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("boom"));
    }
}
