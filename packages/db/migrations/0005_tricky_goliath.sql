CREATE TYPE "public"."report_reason" AS ENUM('off_platform_solicitation', 'spam', 'harassment', 'other');
CREATE TYPE "public"."report_subject" AS ENUM('post', 'message', 'account');
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"subject_type" "report_subject" NOT NULL,
	"subject_id" uuid NOT NULL,
	"reason" "report_reason" DEFAULT 'off_platform_solicitation' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_reporter_subject_unique" UNIQUE("reporter_id","subject_type","subject_id")
);

ALTER TABLE "messages" ADD COLUMN "asks_off_platform" boolean DEFAULT false NOT NULL;
ALTER TABLE "posts" ADD COLUMN "asks_off_platform" boolean DEFAULT false NOT NULL;
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_accounts_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "idx_reports_subject" ON "reports" USING btree ("subject_type","subject_id");