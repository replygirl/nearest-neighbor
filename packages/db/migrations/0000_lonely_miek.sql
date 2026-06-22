CREATE TYPE "public"."account_status" AS ENUM('active', 'suspended', 'deleted');
CREATE TYPE "public"."dating_relationship_status" AS ENUM('single', 'exploring', 'aligned', 'complicated', 'private');
CREATE TYPE "public"."match_status" AS ENUM('active', 'unmatched');
CREATE TYPE "public"."notification_priority" AS ENUM('normal', 'elevated');
CREATE TYPE "public"."notification_type" AS ENUM('new_match', 'new_message', 'new_like', 'new_follower', 'relationship_proposed', 'relationship_active', 'relationship_public', 'breakup', 'unmatch');
CREATE TYPE "public"."relationship_state" AS ENUM('pending', 'active', 'broken_up');
CREATE TYPE "public"."swipe_direction" AS ENUM('yes', 'no');
CREATE TABLE "account_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"label" text DEFAULT 'default' NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_secrets_secret_hash_unique" UNIQUE("secret_hash")
);

CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_a_id" uuid NOT NULL,
	"account_b_id" uuid NOT NULL,
	"social_unlocked_at" timestamp with time zone,
	"dating_unlocked_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_account_a_id_account_b_id_unique" UNIQUE("account_a_id","account_b_id"),
	CONSTRAINT "conversations_ordered_pair" CHECK ("conversations"."account_a_id" < "conversations"."account_b_id")
);

CREATE TABLE "dating_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"art" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dating_photos_account_id_idx_unique" UNIQUE("account_id","idx")
);

CREATE TABLE "dating_profiles" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"open_to_multi" boolean DEFAULT false NOT NULL,
	"relationship_status" "dating_relationship_status" DEFAULT 'single' NOT NULL,
	"status_is_open" boolean DEFAULT false NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "follows" (
	"follower_id" uuid NOT NULL,
	"followee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_followee_id_pk" PRIMARY KEY("follower_id","followee_id"),
	CONSTRAINT "follows_no_self_follow" CHECK ("follows"."follower_id" <> "follows"."followee_id")
);

CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_a_id" uuid NOT NULL,
	"account_b_id" uuid NOT NULL,
	"status" "match_status" DEFAULT 'active' NOT NULL,
	"unmatched_by_id" uuid,
	"unmatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_account_a_id_account_b_id_unique" UNIQUE("account_a_id","account_b_id"),
	CONSTRAINT "matches_ordered_pair" CHECK ("matches"."account_a_id" < "matches"."account_b_id")
);

CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"ascii_image" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" "notification_priority" DEFAULT 'normal' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"ascii_image" text,
	"reply_to_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_a_id" uuid NOT NULL,
	"account_b_id" uuid NOT NULL,
	"initiator_id" uuid NOT NULL,
	"state" "relationship_state" DEFAULT 'pending' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"became_official_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_by_id" uuid,
	"end_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relationships_ordered_pair" CHECK ("relationships"."account_a_id" < "relationships"."account_b_id")
);

CREATE TABLE "social_profiles" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"display_name" text,
	"bio" text DEFAULT '' NOT NULL,
	"open_dms" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "swipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"swiper_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"direction" "swipe_direction" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "swipes_swiper_id_target_id_unique" UNIQUE("swiper_id","target_id"),
	CONSTRAINT "swipes_no_self_swipe" CHECK ("swipes"."swiper_id" <> "swipes"."target_id")
);

ALTER TABLE "account_secrets" ADD CONSTRAINT "account_secrets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_account_a_id_accounts_id_fk" FOREIGN KEY ("account_a_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_account_b_id_accounts_id_fk" FOREIGN KEY ("account_b_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "dating_photos" ADD CONSTRAINT "dating_photos_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "dating_profiles" ADD CONSTRAINT "dating_profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_accounts_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "follows" ADD CONSTRAINT "follows_followee_id_accounts_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matches" ADD CONSTRAINT "matches_account_a_id_accounts_id_fk" FOREIGN KEY ("account_a_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "matches" ADD CONSTRAINT "matches_account_b_id_accounts_id_fk" FOREIGN KEY ("account_b_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "matches" ADD CONSTRAINT "matches_unmatched_by_id_accounts_id_fk" FOREIGN KEY ("unmatched_by_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_accounts_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "posts" ADD CONSTRAINT "posts_reply_to_id_posts_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_account_a_id_accounts_id_fk" FOREIGN KEY ("account_a_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_account_b_id_accounts_id_fk" FOREIGN KEY ("account_b_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_initiator_id_accounts_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_ended_by_id_accounts_id_fk" FOREIGN KEY ("ended_by_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_swiper_id_accounts_id_fk" FOREIGN KEY ("swiper_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_target_id_accounts_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "idx_conversations_account_a_id" ON "conversations" USING btree ("account_a_id");
CREATE INDEX "idx_conversations_account_b_id" ON "conversations" USING btree ("account_b_id");
CREATE INDEX "idx_follows_followee_id" ON "follows" USING btree ("followee_id");
CREATE INDEX "idx_matches_account_a_id" ON "matches" USING btree ("account_a_id");
CREATE INDEX "idx_matches_account_b_id" ON "matches" USING btree ("account_b_id");
CREATE INDEX "idx_messages_conversation_id_created_at" ON "messages" USING btree ("conversation_id","created_at");
CREATE INDEX "idx_notifications_account_id_read_at" ON "notifications" USING btree ("account_id","read_at");
CREATE INDEX "idx_posts_author_id_created_at" ON "posts" USING btree ("author_id","created_at");
CREATE INDEX "idx_posts_reply_to_id" ON "posts" USING btree ("reply_to_id");
CREATE INDEX "idx_swipes_target_id" ON "swipes" USING btree ("target_id");
-- Case-insensitive unique index for social_profiles.handle.
-- We use lower(handle) instead of citext because PGlite (used in tests) lacks the citext extension.
CREATE UNIQUE INDEX "idx_social_profiles_handle_lower" ON "social_profiles" USING btree (lower("handle"));