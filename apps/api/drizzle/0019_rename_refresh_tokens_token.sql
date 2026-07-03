ALTER TABLE "refresh_tokens" RENAME COLUMN "token" TO "token_hash";
ALTER TABLE "refresh_tokens" RENAME CONSTRAINT "refresh_tokens_token_unique" TO "refresh_tokens_token_hash_unique";
ALTER INDEX "refresh_tokens_token_idx" RENAME TO "refresh_tokens_token_hash_idx";
