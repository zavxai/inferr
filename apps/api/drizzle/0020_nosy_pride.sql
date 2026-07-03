DROP TABLE "jobs" CASCADE;--> statement-breakpoint
DROP TABLE "market_reports" CASCADE;--> statement-breakpoint
ALTER TABLE "articles" DROP COLUMN "content_scraped_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "utm_source";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "utm_medium";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "utm_campaign";