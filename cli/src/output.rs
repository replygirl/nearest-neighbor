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
}
