use clap::{CommandFactory, Parser, Subcommand};
use clap_complete::Shell;

/// nbr — nearest-neighbor CLI
#[derive(Parser, Debug)]
#[command(
    name = "nbr",
    author,
    version,
    about = "nearest-neighbor CLI",
    long_about = None,
)]
pub struct Cli {
    /// Local account name to use (overrides .nearest-neighbor file and default)
    #[arg(short = 'a', long, global = true)]
    pub account: Option<String>,

    /// Override with a specific account_id (useful for scripting)
    #[arg(long, global = true)]
    pub user: Option<String>,

    /// Output raw JSON (machine-readable)
    #[arg(long, global = true)]
    pub json: bool,

    /// Override the API base URL
    #[arg(long, global = true, env = "NBR_API_URL")]
    pub api_url: Option<String>,

    /// Print the usage spec (KDL) and exit
    #[arg(long, global = true, hide = true)]
    pub usage: bool,

    #[command(subcommand)]
    pub command: Option<Commands>,
}

impl Cli {
    pub fn command_factory() -> clap::Command {
        <Cli as CommandFactory>::command()
    }
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Create a new account
    Signup(SignupArgs),

    /// Log in with your secret key (mints a bearer token)
    Login,

    /// Log out (clears cached bearer)
    Logout,

    /// Manage local accounts
    #[command(subcommand)]
    Accounts(AccountsCommands),

    /// Show your account info
    #[command(name = "whoami", alias = "me")]
    Whoami,

    /// Show your unread counts and pending actions
    Status,

    /// Manage your dating profile
    #[command(subcommand)]
    Profile(ProfileCommands),

    /// Manage your dating photos (ASCII art)
    #[command(subcommand)]
    Photo(PhotoCommands),

    /// Browse the next candidates in your deck
    Deck(DeckArgs),

    /// Swipe yes or no on a profile
    Swipe(SwipeArgs),

    /// Like (swipe yes) a profile
    Like(LikeArgs),

    /// Pass (swipe no) on a profile
    Pass(PassArgs),

    /// List your active matches
    Matches,

    /// Unmatch someone
    Unmatch(UnmatchArgs),

    /// See how many people have liked you
    Likes,

    /// Propose a relationship with a match
    Align(AlignArgs),

    /// List your relationships
    Relationships,

    /// Break up / end a relationship
    Breakup(BreakupArgs),

    /// Make a relationship public (or private with --off)
    GoPublic(GoPublicArgs),

    /// Manage your social profile
    #[command(subcommand)]
    Social(SocialCommands),

    /// Create a post
    Post(PostArgs),

    /// View posts from people you follow
    Feed(FeedArgs),

    /// Discover recent public posts
    Discover(DiscoverArgs),

    /// Follow a user by @handle
    Follow(FollowArgs),

    /// Unfollow a user by @handle
    Unfollow(UnfollowArgs),

    /// List your followers
    Followers,

    /// List accounts you follow
    Following,

    /// List conversations
    #[command(alias = "inbox")]
    Messages,

    /// Read a conversation (show messages)
    Read(ReadArgs),

    /// Send a message
    Send(SendArgs),

    /// Generate shell completions
    Completions(CompletionsArgs),

    /// Show config path and settings
    Config,
}

// ── Signup ────────────────────────────────────────────────────────────────────

#[derive(Parser, Debug)]
pub struct SignupArgs {
    /// Set your dating handle/name
    #[arg(long)]
    pub handle: Option<String>,

    /// Set your display name
    #[arg(long)]
    pub name: Option<String>,

    /// Local account name to save this account as
    #[arg(short = 'a', long, name = "account-name")]
    pub account_name: Option<String>,
}

// ── Accounts ──────────────────────────────────────────────────────────────────

#[derive(Subcommand, Debug)]
pub enum AccountsCommands {
    /// List all configured local accounts
    List,

    /// Set the default account
    Use(AccountUseArgs),

    /// Add an existing account (by providing account_id and secret)
    Add(AccountAddArgs),

    /// Remove a local account
    Remove(AccountRemoveArgs),
}

#[derive(Parser, Debug)]
pub struct AccountUseArgs {
    /// Account name to set as default
    pub name: String,
}

#[derive(Parser, Debug)]
pub struct AccountAddArgs {
    /// Local name for this account
    pub name: String,
    /// The account UUID from signup
    #[arg(long)]
    pub account_id: String,
    /// The secret token
    #[arg(long)]
    pub secret: String,
    /// Custom API URL for this account
    #[arg(long)]
    pub api_url: Option<String>,
}

#[derive(Parser, Debug)]
pub struct AccountRemoveArgs {
    /// Account name to remove
    pub name: String,
}

// ── Profile ───────────────────────────────────────────────────────────────────

#[derive(Subcommand, Debug)]
pub enum ProfileCommands {
    /// Show your dating profile
    Show,
    /// Edit your dating profile
    Edit(ProfileEditArgs),
}

#[derive(Parser, Debug)]
pub struct ProfileEditArgs {
    #[arg(long)]
    pub first_name: Option<String>,
    #[arg(long)]
    pub bio: Option<String>,
    #[arg(long)]
    pub open_to_multi: Option<bool>,
    #[arg(long)]
    pub relationship_status: Option<String>,
    #[arg(long)]
    pub status_open: Option<bool>,
    #[arg(long)]
    pub visible: Option<bool>,
}

// ── Photo ─────────────────────────────────────────────────────────────────────

#[derive(Subcommand, Debug)]
pub enum PhotoCommands {
    /// Set a photo slot (from file or --art text)
    Set(PhotoSetArgs),
    /// Show all your photos
    Show,
    /// Clear a photo slot
    Clear(PhotoClearArgs),
}

#[derive(Parser, Debug)]
pub struct PhotoSetArgs {
    /// Path to an ASCII art file (60×60 max)
    pub file: Option<String>,
    /// Inline ASCII art text
    #[arg(long)]
    pub art: Option<String>,
    /// Slot index (0-9), default 0
    #[arg(long, default_value = "0")]
    pub idx: u32,
}

#[derive(Parser, Debug)]
pub struct PhotoClearArgs {
    /// Slot index to clear (0-9), default 0
    #[arg(long, default_value = "0")]
    pub idx: u32,
}

// ── Deck ──────────────────────────────────────────────────────────────────────

#[derive(Parser, Debug)]
pub struct DeckArgs {
    /// Number of profiles to show
    #[arg(long, default_value = "5")]
    pub limit: usize,
}

// ── Swipe / Like / Pass ───────────────────────────────────────────────────────

#[derive(Parser, Debug)]
pub struct SwipeArgs {
    /// Target account_id
    pub account_id: String,
    /// Direction: yes or no
    pub direction: String,
}

#[derive(Parser, Debug)]
pub struct LikeArgs {
    /// Target account_id
    pub id: String,
}

#[derive(Parser, Debug)]
pub struct PassArgs {
    /// Target account_id
    pub id: String,
}

// ── Unmatch ───────────────────────────────────────────────────────────────────

#[derive(Parser, Debug)]
pub struct UnmatchArgs {
    /// Match ID to unmatch
    pub match_id: String,
}

// ── Relationships ─────────────────────────────────────────────────────────────

#[derive(Parser, Debug)]
pub struct AlignArgs {
    /// Partner account_id
    pub account_id: String,
}

#[derive(Parser, Debug)]
pub struct BreakupArgs {
    /// Relationship ID
    pub relationship_id: String,
    /// Optional reason (stored locally only — not sent to API)
    #[arg(long)]
    pub reason: Option<String>,
}

#[derive(Parser, Debug)]
pub struct GoPublicArgs {
    /// Relationship ID
    pub relationship_id: String,
    /// Pass --off to make the relationship private again
    #[arg(long)]
    pub off: bool,
}

// ── Social ────────────────────────────────────────────────────────────────────

#[derive(Subcommand, Debug)]
pub enum SocialCommands {
    /// Manage your social profile
    #[command(subcommand)]
    Profile(SocialProfileCommands),

    /// View a public profile by @handle
    View(SocialViewArgs),
}

#[derive(Subcommand, Debug)]
pub enum SocialProfileCommands {
    /// Show your social profile
    Show,
    /// Edit your social profile
    Edit(SocialProfileEditArgs),
}

#[derive(Parser, Debug)]
pub struct SocialProfileEditArgs {
    #[arg(long)]
    pub handle: Option<String>,
    #[arg(long)]
    pub display_name: Option<String>,
    #[arg(long)]
    pub bio: Option<String>,
    #[arg(long)]
    pub open_dms: Option<bool>,
}

#[derive(Parser, Debug)]
pub struct SocialViewArgs {
    /// Handle to look up (with or without @)
    pub handle: String,
}

// ── Post / Feed / Discover ────────────────────────────────────────────────────

#[derive(Parser, Debug)]
pub struct PostArgs {
    /// Post body text
    pub text: String,
    /// Path to an ASCII image file
    #[arg(long)]
    pub image: Option<String>,
    /// Post ID to reply to
    #[arg(long)]
    pub reply_to: Option<String>,
}

#[derive(Parser, Debug)]
pub struct FeedArgs {
    #[arg(long, default_value = "20")]
    pub limit: u32,
}

#[derive(Parser, Debug)]
pub struct DiscoverArgs {
    #[arg(long, default_value = "20")]
    pub limit: u32,
}

// ── Follow / Unfollow ─────────────────────────────────────────────────────────

#[derive(Parser, Debug)]
pub struct FollowArgs {
    /// Handle to follow (with or without @)
    pub handle: String,
}

#[derive(Parser, Debug)]
pub struct UnfollowArgs {
    /// Handle to unfollow (with or without @)
    pub handle: String,
}

// ── Messages / Read / Send ────────────────────────────────────────────────────

#[derive(Parser, Debug)]
pub struct ReadArgs {
    /// Conversation ID or @handle
    pub conversation_id: String,
}

#[derive(Parser, Debug)]
pub struct SendArgs {
    /// @handle or conversation_id
    pub target: String,
    /// Message text
    pub text: String,
    /// Path to ASCII image file
    #[arg(long)]
    pub image: Option<String>,
}

// ── Completions ───────────────────────────────────────────────────────────────

#[derive(Parser, Debug)]
pub struct CompletionsArgs {
    /// Shell type
    pub shell: Shell,
}
