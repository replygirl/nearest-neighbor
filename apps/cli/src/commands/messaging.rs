/// Messaging command stubs — phase 2 will polish these.
use anyhow::Result;

use crate::cli::{ReadArgs, SendArgs};
use crate::client::ApiClient;
use crate::models::{SendMessageRequest, StartConversationRequest};
use crate::output::{print_off_platform_banner, print_success, print_table};

/// Returns true iff `s` is a lowercase or mixed-case UUID v4 string
/// (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx, 36 chars, only hex + hyphens).
fn is_uuid(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 36 {
        return false;
    }
    let hyphen_positions = [8usize, 13, 18, 23];
    for (i, &byte) in b.iter().enumerate() {
        if hyphen_positions.contains(&i) {
            if byte != b'-' {
                return false;
            }
        } else if !byte.is_ascii_hexdigit() {
            return false;
        }
    }
    true
}

pub async fn run_messages(client: &mut ApiClient, json: bool) -> Result<()> {
    let convs = client.list_conversations().await?;
    if json {
        crate::output::print_json(&convs);
    } else {
        if convs.is_empty() {
            println!("No conversations yet.");
        } else {
            let rows: Vec<Vec<String>> = convs
                .iter()
                .map(|c| {
                    vec![
                        c.id.clone(),
                        c.other
                            .handle
                            .clone()
                            .map(|h| format!("@{h}"))
                            .unwrap_or_else(|| c.other.account_id.clone()),
                        c.unread_count.to_string(),
                        c.last_message_at
                            .clone()
                            .unwrap_or_else(|| "(never)".into()),
                    ]
                })
                .collect();
            print_table(
                &["Conversation ID", "Other", "Unread", "Last Message"],
                rows,
            );
        }
    }
    Ok(())
}

pub async fn run_read(client: &mut ApiClient, args: &ReadArgs, json: bool) -> Result<()> {
    // Reject @handles and non-UUID strings outright — handles are mutable and
    // cannot be used as stable conversation keys.
    let raw = args.conversation_id.trim();
    if raw.starts_with('@') || !is_uuid(raw) {
        if json {
            crate::output::print_json(&serde_json::json!({
                "error": "invalid_argument",
                "message": format!(
                    "\"{}\" is not a conversation_id. \
                     Handles are mutable and cannot identify a conversation. \
                     Run `nbr conversations list --json` to list conversations and obtain the conversation_id UUID.",
                    raw
                )
            }));
            std::process::exit(1);
        } else {
            anyhow::bail!(
                "\"{}\" is not a conversation_id.\n\
                 Handles are mutable and cannot identify a conversation.\n\
                 Run `nbr conversations list --json` to list your conversations and find the conversation_id UUID.",
                raw
            );
        }
    }
    let conv_id = raw;
    let msgs = client.get_messages(conv_id, None, Some(30)).await?;
    if json {
        crate::output::print_json(&msgs);
    } else {
        if msgs.items.is_empty() {
            println!("No messages in this conversation yet.");
        } else {
            for m in msgs.items.iter().rev() {
                println!("[{}] {}: {}", m.created_at, m.sender_id, m.body);
                if m.asks_off_platform {
                    print_off_platform_banner();
                }
            }
        }
    }
    // Mark as read (best-effort)
    let _ = client.read_conversation(conv_id).await;
    Ok(())
}

pub async fn run_send(client: &mut ApiClient, args: &SendArgs, json: bool) -> Result<()> {
    let ascii_image = if let Some(path) = &args.image {
        Some(std::fs::read_to_string(path)?)
    } else {
        None
    };

    // Determine conversation ID: if target starts with @, look up by handle
    let conv_id = if args.target.starts_with('@') {
        let handle = args.target.trim_start_matches('@');
        let conv = client
            .start_conversation(StartConversationRequest {
                handle: Some(handle.to_string()),
                account_id: None,
            })
            .await?;
        conv.id
    } else {
        args.target.clone()
    };

    let req = SendMessageRequest {
        body: args.text.clone(),
        ascii_image,
    };
    let msg = client.send_message(&conv_id, req).await?;
    if json {
        crate::output::print_json(&msg);
    } else {
        print_success("Message sent.");
        println!("Message ID: {}", msg.id);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_uuid;

    #[test]
    fn is_uuid_valid_lowercase() {
        assert!(is_uuid("00000000-0000-0000-0000-000000000001"));
    }

    #[test]
    fn is_uuid_valid_mixed_case_hex() {
        assert!(is_uuid("abcdef12-ABCD-0000-0000-000000000000"));
    }

    #[test]
    fn is_uuid_empty() {
        assert!(!is_uuid(""));
    }

    #[test]
    fn is_uuid_too_short() {
        assert!(!is_uuid("00000000-0000-0000-0000"));
    }

    #[test]
    fn is_uuid_no_hyphens() {
        // 32 hex chars — no hyphens at positions 8/13/18/23
        assert!(!is_uuid("00000000000000000000000000000001"));
    }

    #[test]
    fn is_uuid_hyphen_in_wrong_position() {
        // Hyphen at position 7 instead of 8
        assert!(!is_uuid("0000000-00000-0000-0000-000000000001"));
    }

    #[test]
    fn is_uuid_non_hex_character() {
        // 'z' at the start is not a valid hex digit
        assert!(!is_uuid("zzzzzzzz-0000-0000-0000-000000000001"));
    }

    #[test]
    fn is_uuid_at_handle() {
        assert!(!is_uuid("@alice"));
    }

    #[test]
    fn is_uuid_plain_string() {
        assert!(!is_uuid("not-a-uuid"));
    }

    #[test]
    fn is_uuid_dash_not_at_expected_position_8() {
        // Position 8 must be '-'; use a digit instead
        let mut s: Vec<u8> = b"00000000-0000-0000-0000-000000000001".to_vec();
        s[8] = b'0'; // replace the expected hyphen at position 8 with '0'
        let bad = String::from_utf8(s).unwrap();
        assert!(!is_uuid(&bad));
    }
}
