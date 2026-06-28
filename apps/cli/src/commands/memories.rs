/// Memories commands — the agent's private memory store (who you are, what you
/// want, who you've met). Maps the `memories` clap scope onto the `/v1/memories`
/// CRUD + injection-index endpoints. API errors (e.g. an unknown id → 404, an
/// out-of-range salience → 422) propagate through `ApiClient` as `NbrError` and
/// surface as helpful CLI errors rather than panics.
use anyhow::Result;

use crate::cli::{MemoryAddArgs, MemoryEditArgs, MemoryGetArgs, MemoryIndexArgs, MemoryRemoveArgs};
use crate::client::ApiClient;
use crate::models::{CreateMemoryRequest, MemorySummary, PatchMemoryRequest};
use crate::output::{print_json, print_kv, print_success};

/// Print a one-line summary for list / index output: scope, salience, pinned
/// state, and the description — never the long body.
fn print_summary_line(m: &MemorySummary) {
    let pin = if m.pinned { "*" } else { " " };
    println!(
        "{pin}[{}] {} (salience {:.2})  {}",
        m.scope, m.id, m.salience, m.description
    );
}

pub async fn run_list(client: &mut ApiClient, json: bool) -> Result<()> {
    let resp = client.list_memories().await?;
    if json {
        print_json(&resp);
    } else if resp.items.is_empty() {
        println!("memories: none");
    } else {
        for m in &resp.items {
            print_summary_line(m);
        }
    }
    Ok(())
}

pub async fn run_index(client: &mut ApiClient, args: &MemoryIndexArgs, json: bool) -> Result<()> {
    let resp = client.memory_index(Some(&args.budget)).await?;
    if json {
        print_json(&resp);
    } else {
        println!(
            "budget: {} — {} included, {} omitted",
            resp.budget,
            resp.items.len(),
            resp.omitted_count
        );
        for m in &resp.items {
            print_summary_line(m);
        }
    }
    Ok(())
}

pub async fn run_get(client: &mut ApiClient, args: &MemoryGetArgs, json: bool) -> Result<()> {
    let m = client.get_memory(&args.id).await?;
    if json {
        print_json(&m);
    } else {
        print_kv(&[
            ("id", m.id.clone()),
            ("scope", m.scope.clone()),
            ("description", m.description.clone()),
            ("salience", format!("{:.2}", m.salience)),
            ("pinned", m.pinned.to_string()),
        ]);
        println!();
        println!("{}", m.body);
        if !m.subjects.is_empty() {
            println!();
            println!("subjects: {}", m.subjects.join(", "));
        }
    }
    Ok(())
}

pub async fn run_add(client: &mut ApiClient, args: &MemoryAddArgs, json: bool) -> Result<()> {
    let req = CreateMemoryRequest {
        scope: args.scope.clone(),
        description: args.description.clone(),
        body: args.body.clone(),
        pinned: args.pinned,
        salience: args.salience,
    };
    let m = client.create_memory(req).await?;
    if json {
        print_json(&m);
    } else {
        print_success(&format!("Memory created: {}", m.id));
    }
    Ok(())
}

pub async fn run_edit(client: &mut ApiClient, args: &MemoryEditArgs, json: bool) -> Result<()> {
    let req = PatchMemoryRequest {
        description: args.description.clone(),
        body: args.body.clone(),
        pinned: args.pinned,
        salience: args.salience,
        add_subject: args.add_subject.clone(),
        remove_subject: args.remove_subject.clone(),
    };
    let m = client.patch_memory(&args.id, req).await?;
    if json {
        print_json(&m);
    } else {
        print_success(&format!("Memory updated: {}", m.id));
    }
    Ok(())
}

pub async fn run_remove(client: &mut ApiClient, args: &MemoryRemoveArgs, json: bool) -> Result<()> {
    let resp = client.delete_memory(&args.id).await?;
    if json {
        print_json(&resp);
    } else {
        print_success(&format!("Memory removed: {}", args.id));
    }
    Ok(())
}
