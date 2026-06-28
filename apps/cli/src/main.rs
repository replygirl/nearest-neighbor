use anyhow::Result;
use clap::Parser;
use clap_complete::generate;

use nbr::cli::{Cli, Commands};
use nbr::error::NbrError;

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        // `run()` returns an `anyhow::Error`, which has no `exit_code()` of its
        // own; downcast to recover the `NbrError` exit code (1 otherwise).
        let nbr_err = e.downcast_ref::<NbrError>();
        let code = nbr_err.map(NbrError::exit_code).unwrap_or(1);
        // A content block is fully rendered in the dispatch layer (it needs the
        // `--json` flag, which main cannot see); only its exit code escapes here,
        // so we must not also print the generic error line for it.
        if !matches!(nbr_err, Some(NbrError::ContentBlocked { .. })) {
            nbr::output::print_error(&format!("Error: {e}"));
        }
        std::process::exit(code);
    }
}

async fn run() -> Result<()> {
    let cli = Cli::parse();

    // --usage: print usage spec and exit
    if cli.usage {
        let mut cmd = Cli::command_factory();
        clap_usage::generate(&mut cmd, "nbr", &mut std::io::stdout());
        return Ok(());
    }

    // Completions: handled before lib::run so the shell can capture them cleanly.
    if let Some(Commands::Completions(args)) = &cli.command {
        let mut cmd = Cli::command_factory();
        generate(args.shell, &mut cmd, "nbr", &mut std::io::stdout());
        return Ok(());
    }

    nbr::run(cli).await
}
