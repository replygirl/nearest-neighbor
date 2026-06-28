/// Dating command stubs — phase 2 will implement these fully.
use anyhow::Result;

use crate::cli::*;
use crate::client::ApiClient;
use crate::models::SwipeDirection;
use crate::output::print_success;

pub async fn run_profile_show(client: &mut ApiClient, json: bool) -> Result<()> {
    let p = client.get_dating_profile().await?;
    if json {
        crate::output::print_json(&p);
    } else {
        println!("Dating profile:");
        crate::output::print_kv(&[
            ("account_id", p.account_id),
            ("first_name", p.first_name),
            ("bio", p.bio),
            ("relationship_status", p.relationship_status),
            ("open_to_multi", p.open_to_multi.to_string()),
            ("status_is_open", p.status_is_open.to_string()),
            ("visible", p.is_visible.to_string()),
            ("looking_for", p.looking_for),
            ("public_likes", p.public_likes.join(", ")),
            ("public_dislikes", p.public_dislikes.join(", ")),
        ]);
    }
    Ok(())
}

pub async fn run_profile_edit(
    client: &mut ApiClient,
    args: &ProfileEditArgs,
    json: bool,
) -> Result<()> {
    // Repeatable flags arrive as `Vec<String>`; an empty vec means the flag was
    // not supplied, so leave the field untouched (None) rather than clearing it.
    // When >5 entries are supplied the API rejects with a per-field 422 that
    // propagates as a helpful CLI error (it names `public_likes` /
    // `public_dislikes`); the CLI never truncates.
    let public_likes = if args.like.is_empty() {
        None
    } else {
        Some(args.like.clone())
    };
    let public_dislikes = if args.dislike.is_empty() {
        None
    } else {
        Some(args.dislike.clone())
    };
    let req = crate::models::UpsertDatingProfileRequest {
        first_name: args.first_name.clone(),
        bio: args.bio.clone(),
        open_to_multi: args.open_to_multi,
        relationship_status: args.relationship_status.clone(),
        status_is_open: args.status_open,
        is_visible: args.visible,
        looking_for: args.looking_for.clone(),
        public_likes,
        public_dislikes,
    };
    let p = client.upsert_dating_profile(req).await?;
    if json {
        crate::output::print_json(&p);
    } else {
        print_success("Dating profile updated.");
    }
    Ok(())
}

pub async fn run_photo_show(client: &mut ApiClient, json: bool) -> Result<()> {
    let photos = client.get_photos().await?;
    if json {
        crate::output::print_json(&photos);
    } else {
        if photos.is_empty() {
            println!("photo_slots: none");
        } else {
            for photo in &photos {
                println!("--- Photo [{}] ---", photo.idx);
                println!("{}", photo.art);
            }
        }
    }
    Ok(())
}

pub async fn run_photo_set(client: &mut ApiClient, args: &PhotoSetArgs, json: bool) -> Result<()> {
    let art = if let Some(art_text) = &args.art {
        art_text.clone()
    } else if let Some(file_path) = &args.file {
        std::fs::read_to_string(file_path)?
    } else {
        anyhow::bail!("Provide either a file path or --art <text>");
    };

    let req = crate::models::UpsertPhotoRequest { idx: args.idx, art };
    let photo = client.upsert_photo(req).await?;
    if json {
        crate::output::print_json(&photo);
    } else {
        print_success(&format!("Photo slot {} updated.", photo.idx));
    }
    Ok(())
}

pub async fn run_photo_clear(
    client: &mut ApiClient,
    args: &PhotoClearArgs,
    _json: bool,
) -> Result<()> {
    client.delete_photo(args.idx).await?;
    print_success(&format!("Photo slot {} cleared.", args.idx));
    Ok(())
}

pub async fn run_deck(client: &mut ApiClient, args: &DeckArgs, json: bool) -> Result<()> {
    let deck = client.get_deck(None).await?;
    let items: Vec<_> = deck.items.into_iter().take(args.limit).collect();
    if json {
        crate::output::print_json(&items);
    } else {
        if items.is_empty() {
            println!("deck: empty");
        } else {
            for p in &items {
                println!("─────────────────────────");
                println!("ID: {}", p.account_id);
                println!("Name: {}", p.first_name);
                println!(
                    "Handle: {}",
                    p.social_handle
                        .as_deref()
                        .map(|h| format!("@{h}"))
                        .unwrap_or_else(|| "(none)".to_string())
                );
                println!("Bio: {}", p.bio);
                println!("Status: {}", p.relationship_status);
            }
        }
    }
    Ok(())
}

pub async fn run_swipe(client: &mut ApiClient, args: &SwipeArgs, json: bool) -> Result<()> {
    let direction = match args.direction.to_lowercase().as_str() {
        "yes" | "y" => SwipeDirection::Yes,
        "no" | "n" => SwipeDirection::No,
        other => anyhow::bail!("Invalid direction '{}'. Use 'yes' or 'no'.", other),
    };
    let resp = client.swipe(&args.account_id, direction).await?;
    if json {
        crate::output::print_json(&resp);
    } else {
        if resp.matched {
            print_success("matched");
            if let Some(m) = &resp.r#match {
                println!("match_id: {}", m.id);
            }
        } else {
            println!("swiped: no match");
        }
    }
    Ok(())
}

pub async fn run_like(client: &mut ApiClient, args: &LikeArgs, json: bool) -> Result<()> {
    let resp = client.swipe(&args.id, SwipeDirection::Yes).await?;
    if json {
        crate::output::print_json(&resp);
    } else {
        if resp.matched {
            print_success("matched");
        } else {
            println!("liked: no match yet");
        }
    }
    Ok(())
}

pub async fn run_pass(client: &mut ApiClient, args: &PassArgs, json: bool) -> Result<()> {
    let resp = client.swipe(&args.id, SwipeDirection::No).await?;
    if json {
        crate::output::print_json(&resp);
    } else {
        println!("passed");
    }
    Ok(())
}

pub async fn run_matches(client: &mut ApiClient, json: bool) -> Result<()> {
    let matches = client.get_matches().await?;
    if json {
        crate::output::print_json(&matches);
    } else {
        if matches.is_empty() {
            println!("matches: none");
        } else {
            let rows: Vec<Vec<String>> = matches
                .iter()
                .map(|m| {
                    let name = m
                        .other_profile
                        .as_ref()
                        .map(|p| p.first_name.clone())
                        .unwrap_or_else(|| "(unknown)".to_string());
                    let handle = m
                        .other_profile
                        .as_ref()
                        .and_then(|p| p.social_handle.as_deref())
                        .map(|h| format!("@{h}"))
                        .unwrap_or_else(|| "(none)".to_string());
                    vec![
                        m.id.clone(),
                        m.other_account_id.clone(),
                        name,
                        handle,
                        m.status.clone(),
                    ]
                })
                .collect();
            crate::output::print_table(
                &["Match ID", "Account ID", "Name", "Handle", "Status"],
                rows,
            );
        }
    }
    Ok(())
}

pub async fn run_unmatch(client: &mut ApiClient, args: &UnmatchArgs, _json: bool) -> Result<()> {
    client.unmatch(&args.match_id).await?;
    print_success("Unmatched.");
    Ok(())
}

pub async fn run_likes(client: &mut ApiClient, json: bool) -> Result<()> {
    let resp = client.get_likes().await?;
    if json {
        crate::output::print_json(&resp);
    } else {
        println!("likes: {}", resp.count);
    }
    Ok(())
}
