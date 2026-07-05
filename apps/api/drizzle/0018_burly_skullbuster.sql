ALTER TABLE "pending_auth_codes" ALTER COLUMN "expires_at" SET DATA TYPE timestamp USING to_timestamp(expires_at / 1000.0);--> statement-breakpoint
ALTER TABLE "pending_mcp_authorizations" ALTER COLUMN "expires_at" SET DATA TYPE timestamp USING to_timestamp(expires_at / 1000.0);--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_interests" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "utm_source" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "utm_medium" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "utm_campaign" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_embedding_hnsw_idx" ON "articles" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "market_reports_generated_at_idx" ON "market_reports" USING btree ("generated_at");--> statement-breakpoint
CREATE INDEX "user_interests_query_embedding_hnsw_idx" ON "user_interests" USING hnsw ("query_embedding" vector_cosine_ops);