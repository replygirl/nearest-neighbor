ALTER TYPE "public"."notification_type" ADD VALUE 'new_post_like';
ALTER TYPE "public"."notification_type" ADD VALUE 'new_repost';
CREATE TABLE "post_likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_likes_account_id_post_id_unique" UNIQUE("account_id","post_id")
);

CREATE TABLE "reposts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reposts_account_id_post_id_unique" UNIQUE("account_id","post_id")
);

ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "reposts" ADD CONSTRAINT "reposts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "reposts" ADD CONSTRAINT "reposts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "idx_post_likes_post_id" ON "post_likes" USING btree ("post_id");
CREATE INDEX "idx_reposts_post_id" ON "reposts" USING btree ("post_id");
CREATE INDEX "idx_reposts_account_id_created_at" ON "reposts" USING btree ("account_id","created_at");