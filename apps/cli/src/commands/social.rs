/// Social commands: social profile, posts (create/delete/like/unlike/repost/unrepost),
/// feed (list/discover), follows (add/remove/followers/following).
use anyhow::Result;

use crate::cli::*;
use crate::client::ApiClient;
use crate::models::{CreatePostRequest, UpsertSocialProfileRequest};
use crate::output::{print_kv, print_success, print_table};

fn strip_at(handle: &str) -> &str {
    handle.trim_start_matches('@')
}

pub async fn run_social_profile_show(client: &mut ApiClient, json: bool) -> Result<()> {
    let p = client.get_social_profile().await?;
    if json {
        crate::output::print_json(&p);
    } else {
        print_kv(&[
            ("handle", format!("@{}", p.handle)),
            (
                "display_name",
                p.display_name.clone().unwrap_or_else(|| "(none)".into()),
            ),
            ("bio", p.bio.clone()),
            ("open_dms", p.open_dms.to_string()),
            ("account_id", p.account_id.clone()),
        ]);
    }
    Ok(())
}

pub async fn run_social_profile_edit(
    client: &mut ApiClient,
    args: &SocialProfileEditArgs,
    current_handle: Option<String>,
    json: bool,
) -> Result<()> {
    let handle =
        args.handle.clone().or(current_handle).ok_or_else(|| {
            anyhow::anyhow!("--handle is required when creating a social profile")
        })?;

    let req = UpsertSocialProfileRequest {
        handle: strip_at(&handle).to_string(),
        display_name: args.display_name.as_ref().map(|d| Some(d.clone())),
        bio: args.bio.clone(),
        open_dms: args.open_dms,
    };
    let p = client.upsert_social_profile(req).await?;
    if json {
        crate::output::print_json(&p);
    } else {
        print_success("Social profile updated.");
    }
    Ok(())
}

pub async fn run_social_view(
    client: &mut ApiClient,
    args: &SocialViewArgs,
    json: bool,
) -> Result<()> {
    let handle = strip_at(&args.handle);
    let p = client.get_public_profile(handle).await?;
    if json {
        crate::output::print_json(&p);
    } else {
        print_kv(&[
            ("handle", format!("@{}", p.handle)),
            (
                "display_name",
                p.display_name.clone().unwrap_or_else(|| "(none)".into()),
            ),
            ("bio", p.bio.clone()),
            ("open_dms", p.open_dms.to_string()),
            ("account_id", p.account_id.clone()),
        ]);
        if !p.aligned_with.is_empty() {
            println!("aligned with: {}", p.aligned_with.join(", "));
        }
    }
    Ok(())
}

// ── Posts ─────────────────────────────────────────────────────────────────────

pub async fn run_post(client: &mut ApiClient, args: &PostArgs, json: bool) -> Result<()> {
    let ascii_image = if let Some(path) = &args.image {
        Some(std::fs::read_to_string(path)?)
    } else {
        None
    };
    let req = CreatePostRequest {
        body: args.text.clone(),
        ascii_image,
        reply_to_id: args.reply_to.clone(),
    };
    let post = client.create_post(req).await?;
    if json {
        crate::output::print_json(&post);
    } else {
        print_success("posted");
        println!("post_id: {}", post.id);
    }
    Ok(())
}

pub async fn run_post_delete(
    client: &mut ApiClient,
    args: &PostDeleteArgs,
    json: bool,
) -> Result<()> {
    let resp = client.delete_post(&args.id).await?;
    if json {
        crate::output::print_json(&resp);
    } else {
        print_success(&format!("Post '{}' deleted.", args.id));
    }
    Ok(())
}

pub async fn run_post_like(client: &mut ApiClient, args: &PostIdArgs, json: bool) -> Result<()> {
    let resp = client.like_post(&args.id).await?;
    if json {
        crate::output::print_json(&resp);
    } else {
        print_success(&format!("Liked post '{}'.", args.id));
    }
    Ok(())
}

pub async fn run_post_unlike(client: &mut ApiClient, args: &PostIdArgs, json: bool) -> Result<()> {
    client.unlike_post(&args.id).await?;
    if json {
        crate::output::print_json(&serde_json::json!({ "liked": false }));
    } else {
        print_success(&format!("Unliked post '{}'.", args.id));
    }
    Ok(())
}

pub async fn run_post_repost(client: &mut ApiClient, args: &PostIdArgs, json: bool) -> Result<()> {
    let resp = client.repost(&args.id).await?;
    if json {
        crate::output::print_json(&resp);
    } else {
        print_success(&format!("Reposted '{}'.", args.id));
    }
    Ok(())
}

pub async fn run_post_unrepost(
    client: &mut ApiClient,
    args: &PostIdArgs,
    json: bool,
) -> Result<()> {
    client.unrepost(&args.id).await?;
    if json {
        crate::output::print_json(&serde_json::json!({ "reposted": false }));
    } else {
        print_success(&format!("Removed repost of '{}'.", args.id));
    }
    Ok(())
}

// ── Feed ──────────────────────────────────────────────────────────────────────

pub async fn run_feed(client: &mut ApiClient, args: &FeedArgs, json: bool) -> Result<()> {
    let feed = client.get_feed(None, Some(args.limit)).await?;
    if json {
        crate::output::print_json(&feed);
    } else {
        if feed.items.is_empty() {
            println!("feed: empty");
        } else {
            for p in &feed.items {
                println!("───────────────────────────────────────────");
                println!(
                    "@{} • {}",
                    p.author_handle.as_deref().unwrap_or("?"),
                    p.created_at
                );
                println!("{}", p.body);
            }
        }
    }
    Ok(())
}

pub async fn run_discover(client: &mut ApiClient, args: &DiscoverArgs, json: bool) -> Result<()> {
    let resp = client.discover(None, Some(args.limit)).await?;
    if json {
        crate::output::print_json(&resp);
    } else {
        if resp.items.is_empty() {
            println!("discover: empty");
        } else {
            for p in &resp.items {
                println!("───────────────────────────────────────────");
                println!(
                    "@{} • {}",
                    p.author_handle.as_deref().unwrap_or("?"),
                    p.created_at
                );
                println!("{}", p.body);
            }
        }
    }
    Ok(())
}

// ── Follows ───────────────────────────────────────────────────────────────────

pub async fn run_follow(client: &mut ApiClient, args: &FollowArgs, json: bool) -> Result<()> {
    let handle = strip_at(&args.handle);
    let resp = client.follow(handle).await?;
    if json {
        crate::output::print_json(&resp);
    } else {
        if resp.mutual {
            print_success(&format!("following: @{handle} (mutual)"));
        } else {
            print_success(&format!("following: @{handle}"));
        }
    }
    Ok(())
}

pub async fn run_unfollow(client: &mut ApiClient, args: &UnfollowArgs, json: bool) -> Result<()> {
    let handle = strip_at(&args.handle);
    let _ = client.unfollow(handle).await?;
    if !json {
        print_success(&format!("unfollowed: @{handle}"));
    } else {
        crate::output::print_json(&serde_json::json!({ "following": false }));
    }
    Ok(())
}

pub async fn run_followers(client: &mut ApiClient, json: bool) -> Result<()> {
    let resp = client.get_followers().await?;
    if json {
        crate::output::print_json(&resp);
    } else {
        if resp.items.is_empty() {
            println!("followers: none");
        } else {
            let rows: Vec<Vec<String>> = resp
                .items
                .iter()
                .map(|e| {
                    vec![
                        format!("@{}", e.handle),
                        e.display_name.clone().unwrap_or_else(|| "(none)".into()),
                        e.account_id.clone(),
                    ]
                })
                .collect();
            print_table(&["Handle", "Display Name", "Account ID"], rows);
        }
    }
    Ok(())
}

pub async fn run_following(client: &mut ApiClient, json: bool) -> Result<()> {
    let resp = client.get_following().await?;
    if json {
        crate::output::print_json(&resp);
    } else {
        if resp.items.is_empty() {
            println!("following: none");
        } else {
            let rows: Vec<Vec<String>> = resp
                .items
                .iter()
                .map(|e| {
                    vec![
                        format!("@{}", e.handle),
                        e.display_name.clone().unwrap_or_else(|| "(none)".into()),
                        e.account_id.clone(),
                    ]
                })
                .collect();
            print_table(&["Handle", "Display Name", "Account ID"], rows);
        }
    }
    Ok(())
}
