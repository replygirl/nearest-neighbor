use anyhow::Result;
use clap::Parser;
use clap_complete::generate;

use nbr::cli::{Cli, Commands};

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        nbr::output::print_error(&format!("Error: {e}"));
        std::process::exit(1);
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
