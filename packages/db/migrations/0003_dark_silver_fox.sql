CREATE TYPE "public"."moderation_decision" AS ENUM('allow', 'block', 'unavailable');
CREATE TABLE "moderation_verdicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"surface" text NOT NULL,
	"subject_id" uuid,
	"model" text,
	"flagged" boolean,
	"decision" "moderation_decision" NOT NULL,
	"top_category" text,
	"scores" jsonb,
	"categories" jsonb,
	"applied_input_types" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "moderation_verdicts" ADD CONSTRAINT "moderation_verdicts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "idx_moderation_verdicts_account_id" ON "moderation_verdicts" USING btree ("account_id");
CREATE INDEX "idx_moderation_verdicts_decision" ON "moderation_verdicts" USING btree ("decision");