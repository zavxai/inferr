import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, desc, eq, lt } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DrizzleDB } from '../db/drizzle.provider';
import { cronLocks, cronRuns } from '../db/schema';
import { ScraperService } from '../scraper/scraper.service';
import { AiService } from '../ai/ai.service';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000; // 6 hours safety TTL for locks
const CATCHUP_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours — run catchup if last success was longer ago
const MAX_RETRY_ATTEMPTS = 3;

@Injectable()
export class SchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly scraperService: ScraperService,
    private readonly aiService: AiService,
  ) {}

  // ──────────────────────────────────────────────
  // Startup catchup: if a job hasn't succeeded in 24h, run it now
  // ──────────────────────────────────────────────
  onApplicationBootstrap() {
    // Small delay so the rest of the app is fully wired before we start I/O
    setTimeout(() => void this.catchupMissedJobs(), 5_000);
  }

  private async catchupMissedJobs(): Promise<void> {
    const jobDefs: { name: string; runner: () => Promise<void> }[] = [
      { name: 'runDailyScrape', runner: () => this.executeDailyScrape() },
    ];

    for (const job of jobDefs) {
      try {
        const lastSuccess = await this.getLastSuccessfulRun(job.name);
        const elapsed = lastSuccess
          ? Date.now() - lastSuccess.getTime()
          : Infinity;

        if (elapsed > CATCHUP_THRESHOLD_MS) {
          const ago = lastSuccess
            ? `${(elapsed / 3_600_000).toFixed(1)}h ago`
            : 'never';
          this.logger.warn(
            `Catchup: ${job.name} last succeeded ${ago} — triggering now`,
          );
          await this.runWithLock(job.name, SIX_HOURS_MS, job.runner);
        } else {
          this.logger.log(
            `Catchup: ${job.name} last succeeded ${(elapsed / 3_600_000).toFixed(1)}h ago — OK`,
          );
        }
      } catch (err) {
        this.logger.error(`Catchup check failed for ${job.name}: ${err}`);
      }
    }
  }

  // ──────────────────────────────────────────────
  // Cron handlers
  // ──────────────────────────────────────────────



  @Cron('30 1 * * *')
  async runDailyScrape() {
    await this.runWithLock('runDailyScrape', SIX_HOURS_MS, () =>
      this.executeDailyScrape(),
    );
  }

  // ──────────────────────────────────────────────
  // Job implementations (with retry)
  // ──────────────────────────────────────────────



  private async executeDailyScrape(): Promise<void> {
    this.logger.log('Starting daily scrape pipeline');

    const scraped = await this.withRetry('scrapeAll', () =>
      this.scraperService.scrapeAll(),
    );
    this.logger.log(`Scraped — HN: ${scraped.hn}, Dev.to: ${scraped.devto}`);

    const { processed, failed } = await this.withRetry(
      'processUnsummarized',
      () => this.aiService.processUnsummarized(50),
    );
    this.logger.log(`Summarized/embedded: ${processed} ok, ${failed} failed`);

    const cleaned = await this.withRetry('cleanOldArticles', () =>
      this.scraperService.cleanOldArticles(100),
    );
    this.logger.log(`Pruned database to keep only ${cleaned} articles`);
  }

  // ──────────────────────────────────────────────
  // Retry helper — exponential backoff (2s, 4s, 8s)
  // ──────────────────────────────────────────────

  private async withRetry<T>(
    stepName: string,
    fn: () => Promise<T>,
    attempt = 1,
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= MAX_RETRY_ATTEMPTS) {
        this.logger.error(
          `Step "${stepName}" failed after ${attempt} attempt(s): ${err}`,
        );
        throw err;
      }
      const delayMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      this.logger.warn(
        `Step "${stepName}" attempt ${attempt} failed (${err instanceof Error ? err.message : err}). Retrying in ${delayMs}ms…`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
      return this.withRetry(stepName, fn, attempt + 1);
    }
  }

  // ──────────────────────────────────────────────
  // Distributed lock + audit logging
  // ──────────────────────────────────────────────

  private async runWithLock(
    jobName: string,
    lockTtlMs: number,
    callback: () => Promise<void>,
  ): Promise<void> {
    const now = new Date();
    const expiredAt = new Date(now.getTime() - lockTtlMs);

    try {
      // 1. Clean up any expired locks for this specific job
      await this.db
        .delete(cronLocks)
        .where(
          and(
            eq(cronLocks.jobName, jobName),
            lt(cronLocks.lockedAt, expiredAt),
          ),
        );

      // 2. Try to insert a new lock row.
      // Since jobName is the primary key, this will fail with a unique constraint error
      // if another instance holds the active lock.
      await this.db.insert(cronLocks).values({
        jobName,
        lockedAt: now,
      });

      this.logger.log(`Acquired lock for job: ${jobName}`);
    } catch {
      // We assume a unique constraint violation (duplicate key) means the lock is held
      this.logger.warn(
        `Job ${jobName} is already locked by another active instance. Skipping execution.`,
      );
      return;
    }

    // 3. Record the run start in cron_runs
    const [runRow] = await this.db
      .insert(cronRuns)
      .values({ jobName, status: 'running' })
      .returning({ id: cronRuns.id });

    // 4. Execute the job and record outcome
    try {
      await callback();

      // Mark success
      await this.db
        .update(cronRuns)
        .set({ finishedAt: new Date(), status: 'success' })
        .where(eq(cronRuns.id, runRow.id));

      this.logger.log(`Job ${jobName} completed successfully`);
    } catch (err) {
      // Mark failure with error message
      const errorMsg =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      await this.db
        .update(cronRuns)
        .set({ finishedAt: new Date(), status: 'failed', error: errorMsg })
        .where(eq(cronRuns.id, runRow.id));

      this.logger.error(
        `Job ${jobName} failed`,
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      // 5. Release the lock
      try {
        await this.db.delete(cronLocks).where(eq(cronLocks.jobName, jobName));
        this.logger.log(`Released lock for job: ${jobName}`);
      } catch (cleanupErr) {
        this.logger.error(
          `Failed to release lock for job: ${jobName}`,
          cleanupErr instanceof Error ? cleanupErr.stack : String(cleanupErr),
        );
      }
    }
  }

  // ──────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────

  private async getLastSuccessfulRun(jobName: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ finishedAt: cronRuns.finishedAt })
      .from(cronRuns)
      .where(and(eq(cronRuns.jobName, jobName), eq(cronRuns.status, 'success')))
      .orderBy(desc(cronRuns.finishedAt))
      .limit(1);

    return row?.finishedAt ?? null;
  }
}
