// The Platform's alerts, as the standard's operations policy lets them be raised
// (spec/behaviour.md, section 2). Email addresses for failure go where the pack has
// always read them, `notifications.on_failure`, so a bundle built from that field alone
// is what it was, and the addresses fold into one variable when they differ.
import type { Alert, ResolvedModel } from "@ingestron/definitions";
import type { Data } from "./bundle.js";
import { seconds } from "./operations.js";

type Event = "failure" | "slow";

/**
 * The model with its alerts applied: `notifications.on_failure` holds every address an
 * email alert sends failures to, and `alerts` keeps the destinations, and email alerts
 * for slow runs, each with only the events the standard raises. Build from this once.
 */
export function withAlerts(model: ResolvedModel): ResolvedModel {
  const raised = raisedEvents(model);
  const failure = raised.includes("failure");
  const emails = model.platform.alerts.filter((alert) => alert.kind === "email");
  const onFailure = failure ? addresses(emails, "failure") : [];
  const alerts = model.platform.alerts
    .map((alert) => ({ ...alert, on: alert.on.filter((event) => kept(alert, event, raised)) }))
    .filter((alert) => alert.on.length > 0);
  const notifications = { ...model.platform.notifications, on_failure: onFailure };
  return { ...model, platform: { ...model.platform, notifications, alerts } };
}

/** The events the standard raises alerts for; `slow` only with the time after which a run is. */
function raisedEvents(model: ResolvedModel): Event[] {
  const { on, slow_after } = model.operations.alerts;
  return on.filter((event) => event === "failure" || slow_after !== undefined);
}

/** Email failures are in `notifications.on_failure`; every other raised event stays. */
function kept(alert: Alert, event: Event, raised: Event[]): boolean {
  return raised.includes(event) && !(alert.kind === "email" && event === "failure");
}

/** Each address the email alerts send this event to, once, in the order written. */
function addresses(alerts: Alert[], event: Event): string[] {
  const all = alerts.flatMap((alert) =>
    alert.kind === "email" && alert.on.includes(event) ? alert.to : [],
  );
  return [...new Set(all)];
}

/**
 * The refresh job's alerts, from a model built `withAlerts`: email and webhook
 * notifications, and a run duration health rule when slow runs are raised.
 */
export function jobAlerts(model: ResolvedModel): Data {
  const { platform, operations } = model;
  // When the alerts differ between environments in number, folding leaves them a marker.
  const alerts = Array.isArray(platform.alerts) ? platform.alerts : [];
  const slowAfter = operations.alerts.slow_after;
  const slow = operations.alerts.on.includes("slow") && slowAfter !== undefined;
  const email = notificationsOf({
    on_failure: platform.notifications.on_failure,
    on_duration_warning_threshold_exceeded: addresses(alerts, "slow"),
  });
  const webhook = notificationsOf({
    on_failure: destinations(alerts, "failure"),
    on_duration_warning_threshold_exceeded: destinations(alerts, "slow"),
  });
  return {
    ...(email && { email_notifications: email }),
    ...(webhook && { webhook_notifications: webhook }),
    ...(slow && {
      health: {
        rules: [{ metric: "RUN_DURATION_SECONDS", op: "GREATER_THAN", value: seconds(slowAfter) }],
      },
    }),
  };
}

/** The destinations the platform holds for this event, as webhook notifications take them. */
function destinations(alerts: Alert[], event: Event): { id: string }[] {
  return alerts.flatMap((alert) =>
    alert.kind === "destination" && alert.on.includes(event) ? [{ id: alert.id }] : [],
  );
}

/** The notifications that have anyone to tell, or undefined when none has. */
function notificationsOf(lists: Record<string, unknown[] | string>): Data | undefined {
  const given = Object.entries(lists).filter(([, list]) => list.length > 0);
  return given.length > 0 ? Object.fromEntries(given) : undefined;
}
