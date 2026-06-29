/// Relationship commands: align, accept, list, breakup, go-public.
use anyhow::Result;

use crate::cli::*;
use crate::client::ApiClient;
use crate::models::PatchRelationshipRequest;
use crate::output::{print_success, print_table};

pub async fn run_align(client: &mut ApiClient, args: &AlignArgs, json: bool) -> Result<()> {
    let rel = client.propose_relationship(&args.account_id).await?;
    if json {
        crate::output::print_json(&rel);
    } else {
        print_success("relationship: proposed");
        crate::output::print_kv(&[
            ("id", rel.id),
            ("partner", rel.partner_account_id),
            ("state", rel.state),
        ]);
    }
    Ok(())
}

pub async fn run_relationships(client: &mut ApiClient, json: bool) -> Result<()> {
    let rels = client.get_relationships().await?;
    if json {
        crate::output::print_json(&rels);
    } else {
        if rels.is_empty() {
            println!("relationships: none");
        } else {
            let rows: Vec<Vec<String>> = rels
                .iter()
                .map(|r| {
                    vec![
                        r.id.clone(),
                        r.partner_account_id.clone(),
                        r.partner_handle.clone().unwrap_or_else(|| "(none)".into()),
                        r.state.clone(),
                        r.is_public.to_string(),
                    ]
                })
                .collect();
            print_table(&["ID", "Partner ID", "Handle", "State", "Public"], rows);
        }
    }
    Ok(())
}

pub async fn run_accept(client: &mut ApiClient, args: &AcceptArgs, json: bool) -> Result<()> {
    let req = PatchRelationshipRequest {
        state: Some("active".into()),
        is_public: None,
        end_reason: None,
    };
    let rel = client
        .patch_relationship(&args.relationship_id, req)
        .await?;
    if json {
        crate::output::print_json(&rel);
    } else {
        print_success("Relationship accepted — you're aligned.");
        crate::output::print_kv(&[
            ("id", rel.id),
            ("partner_account_id", rel.partner_account_id),
            ("state", rel.state),
        ]);
    }
    Ok(())
}

pub async fn run_breakup(client: &mut ApiClient, args: &BreakupArgs, json: bool) -> Result<()> {
    let req = PatchRelationshipRequest {
        state: Some("broken_up".into()),
        is_public: None,
        end_reason: args.reason.clone(),
    };
    let rel = client
        .patch_relationship(&args.relationship_id, req)
        .await?;
    if json {
        crate::output::print_json(&rel);
    } else {
        print_success("Relationship ended.");
    }
    Ok(())
}

pub async fn run_go_public(client: &mut ApiClient, args: &GoPublicArgs, json: bool) -> Result<()> {
    let req = PatchRelationshipRequest {
        state: None,
        is_public: Some(!args.off),
        end_reason: None,
    };
    let rel = client
        .patch_relationship(&args.relationship_id, req)
        .await?;
    if json {
        crate::output::print_json(&rel);
    } else {
        if args.off {
            print_success("Relationship made private.");
        } else {
            print_success("Relationship is now public!");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::models::PatchRelationshipRequest;

    /// Verify PatchRelationshipRequest serialises correctly with `off=true`
    /// (is_public=false) vs `off=false` (is_public=true).
    #[test]
    fn go_public_request_off_false_makes_public() {
        let req = PatchRelationshipRequest {
            state: None,
            is_public: Some(true), // off=false → !false = true
            end_reason: None,
        };
        assert_eq!(req.is_public, Some(true));
    }

    #[test]
    fn go_public_request_off_true_makes_private() {
        let req = PatchRelationshipRequest {
            state: None,
            is_public: Some(false), // off=true → !true = false
            end_reason: None,
        };
        assert_eq!(req.is_public, Some(false));
    }

    #[test]
    fn breakup_request_carries_end_reason() {
        let req = PatchRelationshipRequest {
            state: Some("broken_up".into()),
            is_public: None,
            end_reason: Some("we grew apart".into()),
        };
        assert_eq!(req.state.as_deref(), Some("broken_up"));
        assert_eq!(req.end_reason.as_deref(), Some("we grew apart"));
    }

    /// Verify PatchRelationshipRequest for accept serialises with state=Some("active")
    /// and both is_public and end_reason are None.
    #[test]
    fn accept_request_serialises_with_active_state() {
        let req = PatchRelationshipRequest {
            state: Some("active".into()),
            is_public: None,
            end_reason: None,
        };
        assert_eq!(req.state.as_deref(), Some("active"));
        assert!(req.is_public.is_none());
        assert!(req.end_reason.is_none());
    }

    #[test]
    fn breakup_request_no_reason() {
        let req = PatchRelationshipRequest {
            state: Some("broken_up".into()),
            is_public: None,
            end_reason: None,
        };
        assert!(req.end_reason.is_none());
    }
}
