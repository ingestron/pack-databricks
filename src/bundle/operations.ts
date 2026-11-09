// The standard's operations policy as job settings (spec/behaviour.md, section 2):
// retries and a timeout on each pipeline task, and concurrency on the job.
import type { ResolvedModel } from "@ingestron/definitions";
import type { Data } from "./bundle.js";

/** Seconds in each unit of a duration. */
const unitSeconds: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/**
 * A duration, a whole number and a unit (`s`, `m`, `h` or `d`) such as `5m`, in seconds.
 * Definitions has checked its form.
 */
export function seconds(duration: string): number {
  const unit = duration.slice(-1);
  return Number(duration.slice(0, -1)) * unitSeconds[unit]!;
}

/** What a pipeline task of the refresh job takes: its retries and timeout. */
export function taskOperations(model: ResolvedModel): Data {
  const { retries, timeout } = model.operations;
  return {
    ...(retries && {
      max_retries: retries.count,
      min_retry_interval_millis: seconds(retries.interval) * 1000,
    }),
    ...(timeout && { timeout_seconds: seconds(timeout) }),
  };
}

/** What the refresh job takes: how many runs at once, and whether one more waits. */
export function jobOperations(model: ResolvedModel): Data {
  const { concurrency } = model.operations;
  if (!concurrency) return {};
  return { max_concurrent_runs: concurrency.max_runs, queue: { enabled: concurrency.queue } };
}
