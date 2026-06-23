/// Relationship command stubs — phase 2 will polish these.
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

pub async fn run_breakup(client: &mut ApiClient, args: &BreakupArgs, json: bool) -> Result<()> {
    let req = PatchRelationshipRequest {
        state: Some("broken_up".into()),
        is_public: None,
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
