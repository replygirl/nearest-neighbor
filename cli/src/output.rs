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
