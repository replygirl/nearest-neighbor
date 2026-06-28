CREATE TYPE "public"."memory_scope" AS ENUM('identity', 'narrative', 'taste', 'aspiration', 'anxiety', 'relationship', 'appearance', 'general', 'public_persona');
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"scope" "memory_scope" DEFAULT 'general' NOT NULL,
	"description" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"salience" real DEFAULT 0.5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "memory_subjects" (
	"memory_id" uuid NOT NULL,
	"subject_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_subjects_memory_id_subject_account_id_pk" PRIMARY KEY("memory_id","subject_account_id")
);

ALTER TABLE "dating_profiles" ADD COLUMN "looking_for" text DEFAULT '' NOT NULL;
ALTER TABLE "dating_profiles" ADD COLUMN "public_likes" text[] DEFAULT '{}' NOT NULL;
ALTER TABLE "dating_profiles" ADD COLUMN "public_dislikes" text[] DEFAULT '{}' NOT NULL;
ALTER TABLE "memories" ADD CONSTRAINT "memories_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "memory_subjects" ADD CONSTRAINT "memory_subjects_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "memory_subjects" ADD CONSTRAINT "memory_subjects_subject_account_id_accounts_id_fk" FOREIGN KEY ("subject_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "idx_memories_account_id_created_at_id" ON "memories" USING btree ("account_id","created_at","id");
CREATE INDEX "idx_memory_subjects_subject_account_id" ON "memory_subjects" USING btree ("subject_account_id");