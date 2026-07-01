/// Report command: submit a report on a post, message, or account via
/// `POST /v1/reports`. A `404`/`422` from the API propagates through
/// `ApiClient::report` as `NbrError::ApiError`, which surfaces as a clear,
/// non-panicking CLI error (never a panic).
use anyhow::Result;

use crate::cli::{ReportAccountArgs, ReportMessageArgs, ReportPostArgs};
use crate::client::ApiClient;
use crate::models::ReportRequest;
use crate::output::{print_json, print_success};

/// Strip a single leading `@` from a handle, if present.
fn strip_at(handle: &str) -> &str {
    handle.trim_start_matches('@')
}

async fn submit_report(
    client: &mut ApiClient,
    subject_type: &str,
    subject_id: String,
    reason: &str,
    note: Option<String>,
    json: bool,
) -> Result<()> {
    let req = ReportRequest {
        subject_type: subject_type.to_string(),
        subject_id: subject_id.clone(),
        reason: Some(reason.to_string()),
        note,
    };
    let resp = client.report(&req).await?;
    if json {
        print_json(&resp);
    } else {
        print_success(&format!(
            "Reported {subject_type} {subject_id} ({})",
            resp.reason
        ));
    }
    Ok(())
}

pub async fn run_report_post(
    client: &mut ApiClient,
    args: &ReportPostArgs,
    json: bool,
) -> Result<()> {
    submit_report(
        client,
        "post",
        args.id.clone(),
        &args.reason,
        args.note.clone(),
        json,
    )
    .await
}

pub async fn run_report_message(
    client: &mut ApiClient,
    args: &ReportMessageArgs,
    json: bool,
) -> Result<()> {
    submit_report(
        client,
        "message",
        args.id.clone(),
        &args.reason,
        args.note.clone(),
        json,
    )
    .await
}

pub async fn run_report_account(
    client: &mut ApiClient,
    args: &ReportAccountArgs,
    json: bool,
) -> Result<()> {
    // Bare account_id vs @handle: a handle always starts with '@' — resolve it
    // to an account_id via the public profile lookup before reporting.
    let subject_id = if let Some(handle) = args.target.strip_prefix('@') {
        let profile = client.get_public_profile(strip_at(handle)).await?;
        profile.account_id
    } else {
        args.target.clone()
    };
    submit_report(
        client,
        "account",
        subject_id,
        &args.reason,
        args.note.clone(),
        json,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::strip_at;

    #[test]
    fn strip_at_plain_handle() {
        assert_eq!(strip_at("alice"), "alice");
    }

    #[test]
    fn strip_at_with_at_prefix() {
        assert_eq!(strip_at("@alice"), "alice");
    }
}
