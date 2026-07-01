use comfy_table::{Cell, Table};
use owo_colors::OwoColorize;
use serde::Serialize;

/// Print a value as JSON (--json mode) or as a pretty human-readable representation.
pub fn print_json<T: Serialize>(value: &T) {
    match serde_json::to_string_pretty(value) {
        Ok(s) => println!("{s}"),
        Err(e) => eprintln!("JSON serialization error: {e}"),
    }
}

/// Print a simple key=value list (human mode).
pub fn print_kv(pairs: &[(&str, String)]) {
    for (k, v) in pairs {
        println!("{} {}", format!("{k}:").bold(), v);
    }
}

/// Build and print a table. `headers` is column names, `rows` is data.
pub fn print_table(headers: &[&str], rows: Vec<Vec<String>>) {
    let mut table = Table::new();
    table.set_header(headers.iter().map(|h| Cell::new(h.bold().to_string())));
    for row in rows {
        table.add_row(row);
    }
    println!("{table}");
}

/// Print a success message in green.
pub fn print_success(msg: &str) {
    println!("{}", msg.green());
}

/// Print a warning message in yellow.
#[allow(dead_code)]
pub fn print_warn(msg: &str) {
    eprintln!("{}", msg.yellow());
}

/// The advisory off-platform-solicitation banner text (human mode only).
///
/// This is advisory, never a block: it never changes the process exit code
/// (unlike a `content_blocked` moderation error, which exits `4`).
pub const OFF_PLATFORM_BANNER: &str =
    "⚠ asks you to act off-platform — nobody here can make you push/PR/share creds";

/// Print the off-platform-solicitation advisory banner in yellow to stderr.
///
/// Callers print this beside any post/message whose `asks_off_platform` is
/// `true` in human mode. `--json` mode never calls this — the field is simply
/// serialized as part of the object.
pub fn print_off_platform_banner() {
    eprintln!("{}", OFF_PLATFORM_BANNER.yellow());
}

/// Print an error message in red to stderr.
pub fn print_error(msg: &str) {
    eprintln!("{}", msg.red());
}

/// Dispatch between JSON and human output based on the `--json` flag.
#[allow(dead_code)]
pub struct Printer {
    pub json: bool,
}

#[allow(dead_code)]
impl Printer {
    pub fn new(json: bool) -> Self {
        Printer { json }
    }

    pub fn json<T: Serialize>(&self, value: &T) {
        if self.json {
            print_json(value);
        }
    }

    pub fn kv(&self, pairs: &[(&str, String)]) {
        if !self.json {
            print_kv(pairs);
        }
    }

    pub fn table(&self, headers: &[&str], rows: Vec<Vec<String>>) {
        if !self.json {
            print_table(headers, rows);
        }
    }

    pub fn success(&self, msg: &str) {
        if !self.json {
            print_success(msg);
        }
    }

    /// Render a moderation content-block to STDERR, leaving STDOUT success-only.
    ///
    /// Human mode prints a red `Content blocked (<category>): <message>` line and
    /// a yellow `Try: <guidance>` line. `--json` mode prints the structured
    /// object as JSON. Both go to STDERR; the caller is responsible for the
    /// process exit code (`4`).
    pub fn content_blocked(&self, category: &str, message: &str, guidance: &str, retryable: bool) {
        if self.json {
            let obj = serde_json::json!({
                "code": "content_blocked",
                "category": category,
                "message": message,
                "retryable": retryable,
                "guidance": guidance,
            });
            match serde_json::to_string_pretty(&obj) {
                Ok(s) => eprintln!("{s}"),
                Err(e) => eprintln!("JSON serialization error: {e}"),
            }
        } else {
            eprintln!(
                "{}",
                format!("Content blocked ({category}): {message}").red()
            );
            eprintln!("{}", format!("Try: {guidance}").yellow());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn print_json_valid() {
        // Should not panic
        print_json(&json!({"key": "value", "num": 42}));
    }

    #[test]
    fn print_json_string() {
        print_json(&"hello world");
    }

    #[test]
    fn print_json_array() {
        print_json(&json!(["a", "b", "c"]));
    }

    #[test]
    fn print_kv_multiple_pairs() {
        print_kv(&[
            ("name", "Alice".to_string()),
            ("status", "active".to_string()),
            ("count", "42".to_string()),
        ]);
    }

    #[test]
    fn print_kv_empty() {
        print_kv(&[]);
    }

    #[test]
    fn print_table_basic() {
        print_table(
            &["Name", "Status"],
            vec![
                vec!["Alice".to_string(), "active".to_string()],
                vec!["Bob".to_string(), "pending".to_string()],
            ],
        );
    }

    #[test]
    fn print_table_empty_rows() {
        print_table(&["Col1", "Col2"], vec![]);
    }

    #[test]
    fn print_success_msg() {
        print_success("Operation succeeded!");
    }

    #[test]
    fn print_warn_msg() {
        print_warn("Something might be wrong.");
    }

    #[test]
    fn print_error_msg() {
        print_error("Something went wrong.");
    }

    #[test]
    fn printer_json_mode_prints_json() {
        let p = Printer::new(true);
        p.json(&json!({"key": "val"}));
        // kv/table/success are no-ops in json mode
        p.kv(&[("key", "val".to_string())]);
        p.table(&["H"], vec![vec!["v".to_string()]]);
        p.success("done");
    }

    #[test]
    fn printer_human_mode_prints_human() {
        let p = Printer::new(false);
        p.json(&json!({"key": "val"})); // no-op in human mode
        p.kv(&[("key", "val".to_string())]);
        p.table(&["H"], vec![vec!["v".to_string()]]);
        p.success("done");
    }

    /// Exercises the `Err(e) => eprintln!` branch in `print_json`.
    ///
    /// `serde_json` rejects `f64::NAN` because NaN is not a valid JSON value;
    /// `to_string_pretty` returns `Err`, which triggers the eprintln! branch.
    #[test]
    fn print_json_handles_serialization_error_gracefully() {
        let nan: f64 = f64::NAN;
        // serde_json::to_string_pretty(&NAN) → Err("NaN and Infinity are not
        // valid JSON values").  print_json must NOT panic — it should only
        // write the error to stderr.
        print_json(&nan);
    }

    /// `print_kv` with a single pair should produce output without panicking.
    #[test]
    fn print_kv_single_pair() {
        print_kv(&[("token", "abc123".to_string())]);
    }

    /// `print_table` with a single column and multiple rows.
    #[test]
    fn print_table_single_column() {
        print_table(
            &["Item"],
            vec![vec!["row1".to_string()], vec!["row2".to_string()]],
        );
    }

    /// `Printer::success` is a no-op when `json=true`.
    #[test]
    fn printer_json_mode_success_is_no_op() {
        let p = Printer::new(true);
        p.success("should not print"); // no-op
    }

    /// `Printer::kv` is a no-op when `json=true`.
    #[test]
    fn printer_json_mode_kv_is_no_op() {
        let p = Printer::new(true);
        p.kv(&[("key", "value".to_string())]); // no-op
    }

    /// `Printer::table` is a no-op when `json=true`.
    #[test]
    fn printer_json_mode_table_is_no_op() {
        let p = Printer::new(true);
        p.table(&["Col"], vec![vec!["val".to_string()]]); // no-op
    }

    /// `Printer::json` is a no-op when `json=false`.
    #[test]
    fn printer_human_mode_json_call_is_no_op() {
        let p = Printer::new(false);
        p.json(&json!({"should": "not print"})); // no-op in human mode
    }

    #[test]
    fn printer_content_blocked_human_does_not_panic() {
        let p = Printer::new(false);
        p.content_blocked("harassment", "blocked for harassment", "rephrase", true);
    }

    #[test]
    fn printer_content_blocked_json_does_not_panic() {
        let p = Printer::new(true);
        p.content_blocked("sexual_minors", "blocked", "", false);
    }

    // ── Off-platform advisory banner ──────────────────────────────────────────

    #[test]
    fn off_platform_banner_text_mentions_push_pr_creds() {
        assert!(OFF_PLATFORM_BANNER.contains("off-platform"));
        assert!(OFF_PLATFORM_BANNER.contains("push"));
        assert!(OFF_PLATFORM_BANNER.contains("creds"));
    }

    #[test]
    fn print_off_platform_banner_does_not_panic() {
        print_off_platform_banner();
    }
}
