import { getApplicationOutcomePresentation } from "@applyflow/shared";

type AutoApplyCycleEvent = {
  id: string;
  time: string;
  type: string;
  payload: unknown;
};

type TriageApplication = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  accountId: string;
  jobPostingId: string;
  kind: "blocked_login" | "checkpoint" | "submit_failed" | "dry_run_failed" | "other";
  latestStepName: string | null;
  latestReason: string | null;
  latestArtifactDir: string | null;
  jobPosting: {
    id: string;
    title: string | null;
    companyName: string | null;
    score: number | null;
    url: string;
  };
};

type NotificationItem = {
  id: string;
  createdAt: string;
  kind: string;
  title: string;
  message: string;
  accountId: string | null;
  applicationId: string | null;
  jobPostingId: string | null;
  metadata: unknown;
  readAt: string | null;
};

type NotificationsResponse = {
  notifications: NotificationItem[];
  unreadCount: number;
};

type NotificationPreference = {
  accountId: string;
  notifyLoginRequired: boolean;
  notifyCheckpoint: boolean;
  notifyReadyForReview: boolean;
  notifySubmitted: boolean;
  duplicateCooldownMinutes: number;
};

type AutoApplyStats = {
  accountId: string;
  today: { cycles: number; submitted: number; blocked: number; needsReview: number };
  sessionHealth: SessionHealth;
  recent: {
    cycles: AutoApplyCycleEvent[];
    totals: { discovered: number; synced: number; attemptBudget: number; enqueuedAttempts: number };
  };
};

type SessionHealth = {
  accountId: string;
  status: "healthy" | "re_auth_required" | "checkpoint" | "unknown";
  canRunAutoApply: boolean;
  lastOk: { time: string; payload: unknown } | null;
  lastIssue: { time: string; payload: unknown } | null;
};

type LinkedInAccount = { id: string; createdAt: string; updatedAt: string };
type AutoApplySchedule = {
  id: string;
  accountId: string;
  enabled: boolean;
  cron: string;
  timezone: string;
  maxAttempts: number | null;
  minScore: number | null;
  nextRunAt: string;
  lastTriggeredAt: string | null;
};

function apiAuthHeaders(): Record<string, string> {
  const key = process.env.WEB_API_KEY;
  return key ? { "x-applyflow-api-key": key } : {};
}

function getEventLabel(type: string): string {
  switch (type) {
    case "AUTO_APPLY_CYCLE":
      return "Auto-Apply Cycle";
    case "AUTO_APPLY_SKIPPED_DUE_TO_LIMIT":
      return "Skipped: Daily Limit Reached";
    case "AUTO_APPLY_NO_ELIGIBLE":
      return "Skipped: No Eligible Jobs";
    case "LINKEDIN_BLOCKED":
      return "Blocked By LinkedIn";
    default:
      return type
        .toLowerCase()
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}

function getSessionHealthPresentation(status: SessionHealth["status"]): {
  label: string;
  color: string;
  summary: string;
} {
  switch (status) {
    case "healthy":
      return {
        label: "Healthy",
        color: "#166534",
        summary: "LinkedIn session looks usable for automation.",
      };
    case "checkpoint":
      return {
        label: "Checkpoint Required",
        color: "#991b1b",
        summary: "LinkedIn needs verification before we should run more automation.",
      };
    case "re_auth_required":
      return {
        label: "Re-auth Required",
        color: "#92400e",
        summary: "Session appears stale or logged out. Re-auth before running cycles.",
      };
    default:
      return {
        label: "Unknown",
        color: "#374151",
        summary: "We have not observed enough session signals yet.",
      };
  }
}

function getTriageTone(kind: TriageApplication["kind"]): { label: string; color: string } {
  switch (kind) {
    case "blocked_login":
      return { label: "Blocked Login", color: "#92400e" };
    case "checkpoint":
      return { label: "Checkpoint", color: "#991b1b" };
    case "submit_failed":
      return { label: "Submit Failed", color: "#b42318" };
    case "dry_run_failed":
      return { label: "Dry-Run Failed", color: "#344054" };
    default:
      return { label: "Needs Triage", color: "#475467" };
  }
}

function getFileHref(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function getNotificationTone(kind: string): { color: string; label: string } {
  switch (kind) {
    case "linkedin_login_required":
      return { label: "Login Required", color: "#92400e" };
    case "linkedin_checkpoint":
      return { label: "Checkpoint", color: "#991b1b" };
    case "application_ready_for_review":
      return { label: "Ready For Review", color: "#175cd3" };
    case "application_submitted":
      return { label: "Submitted", color: "#166534" };
    default:
      return { label: "Notification", color: "#475467" };
  }
}

async function getAccounts(): Promise<LinkedInAccount[]> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const res = await fetch(`${baseUrl}/accounts`, { cache: "no-store", headers: apiAuthHeaders() });
  if (!res.ok) throw new Error(`failed to fetch accounts: ${res.status}`);
  const json = (await res.json()) as { accounts: LinkedInAccount[] };
  return json.accounts ?? [];
}

async function getStats(accountId: string): Promise<AutoApplyStats> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const res = await fetch(
    `${baseUrl}/stats/auto-apply?accountId=${encodeURIComponent(accountId)}`,
    {
      cache: "no-store",
      headers: apiAuthHeaders(),
    }
  );
  if (!res.ok) throw new Error(`failed to fetch stats: ${res.status}`);
  return (await res.json()) as AutoApplyStats;
}

async function getSchedule(accountId: string): Promise<AutoApplySchedule | null> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const res = await fetch(
    `${baseUrl}/auto-apply/schedules?accountId=${encodeURIComponent(accountId)}`,
    {
      cache: "no-store",
      headers: apiAuthHeaders(),
    }
  );
  if (!res.ok) throw new Error(`failed to fetch schedule: ${res.status}`);
  const json = (await res.json()) as { schedules: AutoApplySchedule[] };
  return json.schedules?.[0] ?? null;
}

async function getTriageApplications(): Promise<TriageApplication[]> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const res = await fetch(`${baseUrl}/applications/triage?limit=12`, {
    cache: "no-store",
    headers: apiAuthHeaders(),
  });
  if (!res.ok) throw new Error(`failed to fetch triage applications: ${res.status}`);
  const json = (await res.json()) as { applications: TriageApplication[] };
  return json.applications ?? [];
}

async function getNotifications(accountId: string): Promise<NotificationsResponse> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const res = await fetch(
    `${baseUrl}/notifications?accountId=${encodeURIComponent(accountId)}&limit=20`,
    {
      cache: "no-store",
      headers: apiAuthHeaders(),
    }
  );
  if (!res.ok) throw new Error(`failed to fetch notifications: ${res.status}`);
  const json = (await res.json()) as NotificationsResponse;
  return { notifications: json.notifications ?? [], unreadCount: json.unreadCount ?? 0 };
}

async function getNotificationPreference(accountId: string): Promise<NotificationPreference> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const res = await fetch(`${baseUrl}/notification-preferences/${encodeURIComponent(accountId)}`, {
    cache: "no-store",
    headers: apiAuthHeaders(),
  });
  if (!res.ok) throw new Error(`failed to fetch notification preferences: ${res.status}`);
  const json = (await res.json()) as { preference: NotificationPreference };
  return json.preference;
}

async function postJson(path: string, body: unknown): Promise<any> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...apiAuthHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return (await res.json()) as any;
}

export default async function DashboardPage(props: {
  searchParams: Promise<{ accountId?: string }>;
}) {
  const sp = await props.searchParams;
  const accounts = await getAccounts();
  const accountId =
    sp.accountId ?? accounts.at(0)?.id ?? process.env.LINKEDIN_ACCOUNT_ID ?? "default";
  const stats = await getStats(accountId);
  const schedule = await getSchedule(accountId);
  const triageApplications = await getTriageApplications();
  const notificationsResponse = await getNotifications(accountId);
  const notifications = notificationsResponse.notifications;
  const unreadCount = notificationsResponse.unreadCount;
  const notificationPreference = await getNotificationPreference(accountId);

  const defaultMaxAttemptsRaw = process.env.AUTO_APPLY_TOP_N ?? "5";
  const defaultMinScoreRaw = process.env.AUTO_APPLY_MIN_SCORE ?? "70";
  const defaultCron = process.env.AUTO_APPLY_SCHEDULE_DEFAULT_CRON ?? "0 */4 * * *";
  const defaultTimezone = process.env.AUTO_APPLY_SCHEDULE_DEFAULT_TIMEZONE ?? "UTC";
  const submittedTone = getApplicationOutcomePresentation("submitted");
  const blockedTone = getApplicationOutcomePresentation("blocked_checkpoint");
  const reviewTone = getApplicationOutcomePresentation("needs_answers");
  const sessionTone = getSessionHealthPresentation(stats.sessionHealth.status);

  return (
    <main style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <a href="/" style={{ color: "#555" }}>
        ← Back
      </a>
      <h1 style={{ marginBottom: 8 }}>Dashboard</h1>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ color: "#555", fontSize: 14 }}>Account:</div>
        <form method="GET">
          <select
            name="accountId"
            defaultValue={accountId}
            style={{ padding: "6px 8px", borderRadius: 10, border: "1px solid #ddd" }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id}
              </option>
            ))}
            {accounts.length === 0 ? <option value={accountId}>{accountId}</option> : null}
          </select>
          <button style={{ marginLeft: 8, padding: "6px 10px" }}>Load</button>
        </form>
      </div>

      <section style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 16 }}>
        <div style={{ fontWeight: 600 }}>Today</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
          <div>cycles: {stats.today.cycles}</div>
          <div style={{ color: submittedTone.text }}>
            {submittedTone.label}: {stats.today.submitted}
          </div>
          <div style={{ color: blockedTone.text }}>
            {blockedTone.label}: {stats.today.blocked}
          </div>
          <div style={{ color: reviewTone.text }}>
            {reviewTone.label}: {stats.today.needsReview}
          </div>
        </div>
      </section>

      <section
        style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 12, padding: 16 }}
      >
        <div style={{ fontWeight: 600 }}>Session Health</div>
        <div style={{ marginTop: 8, fontWeight: 600, color: sessionTone.color }}>
          {sessionTone.label}
        </div>
        <div style={{ marginTop: 4, color: "#555", fontSize: 14 }}>{sessionTone.summary}</div>
        {stats.sessionHealth.lastOk ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>
            last healthy signal: {new Date(stats.sessionHealth.lastOk.time).toLocaleString()}
          </div>
        ) : null}
        {stats.sessionHealth.lastIssue ? (
          <div style={{ marginTop: 6, fontSize: 12, color: "#92400e" }}>
            last issue: {new Date(stats.sessionHealth.lastIssue.time).toLocaleString()}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
          <form
            action={async () => {
              "use server";
              await postJson(`/accounts/${encodeURIComponent(accountId)}/bootstrap-session`, {});
            }}
          >
            <button style={{ padding: "8px 12px" }}>Bootstrap session</button>
          </form>
          <form
            action={async () => {
              "use server";
              await postJson(`/accounts/${encodeURIComponent(accountId)}/recover-session`, {});
            }}
          >
            <button style={{ padding: "8px 12px" }}>Re-auth and resume automation</button>
          </form>
        </div>
      </section>

      <section
        style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 12, padding: 16 }}
      >
        <div
          style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
        >
          <div style={{ fontWeight: 600 }}>Notifications</div>
          <div style={{ fontSize: 12, color: unreadCount > 0 ? "#b42318" : "#667085" }}>
            unread: {unreadCount}
          </div>
        </div>
        <div style={{ marginTop: 4, color: "#555", fontSize: 13 }}>
          Important operator nudges for login, checkpoints, review-ready applications, and submits.
        </div>
        <form
          action={async (formData) => {
            "use server";
            await postJson(`/notification-preferences/${encodeURIComponent(accountId)}/upsert`, {
              notifyLoginRequired: formData.get("notifyLoginRequired") === "on",
              notifyCheckpoint: formData.get("notifyCheckpoint") === "on",
              notifyReadyForReview: formData.get("notifyReadyForReview") === "on",
              notifySubmitted: formData.get("notifySubmitted") === "on",
              duplicateCooldownMinutes: String(formData.get("duplicateCooldownMinutes") ?? "120"),
            });
          }}
          style={{ display: "grid", gap: 8, marginTop: 12 }}
        >
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, color: "#555" }}>
              <input
                type="checkbox"
                name="notifyLoginRequired"
                defaultChecked={notificationPreference.notifyLoginRequired}
                style={{ marginRight: 6 }}
              />
              login required
            </label>
            <label style={{ fontSize: 12, color: "#555" }}>
              <input
                type="checkbox"
                name="notifyCheckpoint"
                defaultChecked={notificationPreference.notifyCheckpoint}
                style={{ marginRight: 6 }}
              />
              checkpoint
            </label>
            <label style={{ fontSize: 12, color: "#555" }}>
              <input
                type="checkbox"
                name="notifyReadyForReview"
                defaultChecked={notificationPreference.notifyReadyForReview}
                style={{ marginRight: 6 }}
              />
              ready for review
            </label>
            <label style={{ fontSize: 12, color: "#555" }}>
              <input
                type="checkbox"
                name="notifySubmitted"
                defaultChecked={notificationPreference.notifySubmitted}
                style={{ marginRight: 6 }}
              />
              submitted
            </label>
          </div>
          <label style={{ fontSize: 12, color: "#555" }}>
            duplicate cooldown minutes:
            <input
              name="duplicateCooldownMinutes"
              defaultValue={notificationPreference.duplicateCooldownMinutes}
              style={{
                marginLeft: 8,
                padding: "6px 8px",
                borderRadius: 10,
                border: "1px solid #ddd",
                width: 100,
              }}
            />
          </label>
          <button style={{ width: "fit-content", padding: "8px 12px" }}>
            Save notification preferences
          </button>
        </form>
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {notifications.map((notification) => {
            const tone = getNotificationTone(notification.kind);
            const metadata =
              notification.metadata && typeof notification.metadata === "object"
                ? (notification.metadata as Record<string, unknown>)
                : null;
            const artifactDir =
              metadata && typeof metadata.artifactDir === "string" ? metadata.artifactDir : null;

            return (
              <section
                key={notification.id}
                style={{
                  border: "1px solid #eee",
                  borderRadius: 12,
                  padding: 12,
                  background: notification.readAt ? "#fafafa" : "#fff",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: tone.color }}>
                      {tone.label}
                    </div>
                    <div style={{ fontWeight: 600, marginTop: 2 }}>{notification.title}</div>
                    <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>
                      {notification.message}
                    </div>
                    <div style={{ fontSize: 12, color: "#777", marginTop: 6 }}>
                      {new Date(notification.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      alignItems: "flex-start",
                    }}
                  >
                    {notification.applicationId ? (
                      <a
                        href={`/applications/${notification.applicationId}`}
                        style={{ color: "#2563eb", textDecoration: "none", fontSize: 13 }}
                      >
                        Open →
                      </a>
                    ) : null}
                    {artifactDir ? (
                      <a
                        href={getFileHref(artifactDir)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#2563eb", textDecoration: "none", fontSize: 13 }}
                      >
                        Artifacts →
                      </a>
                    ) : null}
                    {!notification.readAt ? (
                      <form
                        action={async () => {
                          "use server";
                          await postJson(`/notifications/${notification.id}/read`, {});
                        }}
                      >
                        <button style={{ padding: "6px 10px" }}>Mark read</button>
                      </form>
                    ) : null}
                    <form
                      action={async () => {
                        "use server";
                        await postJson(`/notifications/${notification.id}/dismiss`, {});
                      }}
                    >
                      <button style={{ padding: "6px 10px" }}>Dismiss</button>
                    </form>
                  </div>
                </div>
              </section>
            );
          })}
          {notifications.length === 0 ? (
            <div
              style={{ padding: 16, border: "1px dashed #ccc", borderRadius: 12, color: "#555" }}
            >
              No notifications right now.
            </div>
          ) : null}
        </div>
      </section>

      <section
        style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 12, padding: 16 }}
      >
        <div style={{ fontWeight: 600 }}>Controls</div>
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
            marginTop: 10,
          }}
        >
          <form
            action={async (formData) => {
              "use server";
              const maxAttempts = Number(formData.get("maxAttempts") ?? 0);
              const minScore = Number(formData.get("minScore") ?? 0);
              await postJson(`/auto-apply/run`, {
                accountId,
                maxAttempts: Number.isFinite(maxAttempts) ? maxAttempts : undefined,
                minScore: Number.isFinite(minScore) ? minScore : undefined,
              });
            }}
            style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
          >
            <label style={{ fontSize: 12, color: "#555" }}>
              maxAttempts:
              <input
                name="maxAttempts"
                defaultValue={defaultMaxAttemptsRaw}
                style={{
                  marginLeft: 8,
                  padding: "6px 8px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  width: 90,
                }}
              />
            </label>
            <label style={{ fontSize: 12, color: "#555" }}>
              minScore:
              <input
                name="minScore"
                defaultValue={defaultMinScoreRaw}
                style={{
                  marginLeft: 8,
                  padding: "6px 8px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  width: 90,
                }}
              />
            </label>
            <button
              disabled={!stats.sessionHealth.canRunAutoApply}
              style={{
                padding: "8px 12px",
                opacity: stats.sessionHealth.canRunAutoApply ? 1 : 0.6,
              }}
            >
              Run auto-apply cycle now
            </button>
          </form>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "#777" }}>
          Tip: refresh the page after triggering a job to see new events and counts.
        </div>
        {!stats.sessionHealth.canRunAutoApply ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#92400e" }}>
            Manual cycle runs are disabled until the LinkedIn session is healthy again.
          </div>
        ) : null}
        <div style={{ marginTop: 10, fontSize: 12, color: "#777" }}>
          Scheduler process: run `npm run dev:scheduler` to turn saved schedules into cycle jobs.
        </div>
        <div style={{ marginTop: 10 }}>
          <a href="/queue" style={{ color: "#2563eb", textDecoration: "none", fontSize: 14 }}>
            View queue →
          </a>
        </div>
      </section>

      <section
        style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 12, padding: 16 }}
      >
        <div style={{ fontWeight: 600 }}>Failure Triage</div>
        <div style={{ marginTop: 4, color: "#555", fontSize: 13 }}>
          Recent blocked and failed applications, ordered by the most actionable issues first.
        </div>
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {triageApplications.map((application) => {
            const tone = getTriageTone(application.kind);
            return (
              <section
                key={application.id}
                style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {application.jobPosting.title ?? "Untitled"} @{" "}
                      {application.jobPosting.companyName ?? "Unknown"}
                    </div>
                    <div style={{ fontSize: 12, color: tone.color, marginTop: 4 }}>
                      {tone.label}
                      {application.latestStepName ? ` · ${application.latestStepName}` : ""}
                    </div>
                    {application.latestReason ? (
                      <div style={{ fontSize: 12, color: "#555", marginTop: 6 }}>
                        {application.latestReason}
                      </div>
                    ) : null}
                    <div style={{ fontSize: 12, color: "#777", marginTop: 6 }}>
                      updated: {new Date(application.updatedAt).toLocaleString()}
                      {typeof application.jobPosting.score === "number"
                        ? ` · score: ${application.jobPosting.score}`
                        : ""}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                    }}
                  >
                    <a
                      href={`/applications/${application.id}`}
                      style={{ color: "#2563eb", textDecoration: "none", fontSize: 13 }}
                    >
                      Open review →
                    </a>
                    <a
                      href={application.jobPosting.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#2563eb", textDecoration: "none", fontSize: 13 }}
                    >
                      LinkedIn job →
                    </a>
                    {application.latestArtifactDir ? (
                      <a
                        href={getFileHref(application.latestArtifactDir)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#2563eb", textDecoration: "none", fontSize: 13 }}
                      >
                        Artifacts →
                      </a>
                    ) : null}
                  </div>
                </div>
              </section>
            );
          })}
          {triageApplications.length === 0 ? (
            <div
              style={{ padding: 16, border: "1px dashed #ccc", borderRadius: 12, color: "#555" }}
            >
              No recent failed or blocked applications.
            </div>
          ) : null}
        </div>
      </section>

      <section
        style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 12, padding: 16 }}
      >
        <div style={{ fontWeight: 600 }}>Schedule</div>
        <form
          action={async (formData) => {
            "use server";
            const enabled = formData.get("enabled") === "on";
            const cron = String(formData.get("cron") ?? "");
            const timezone = String(formData.get("timezone") ?? "");
            await postJson(`/auto-apply/schedules/upsert`, {
              accountId,
              enabled,
              cron,
              timezone,
              maxAttempts: String(formData.get("scheduledMaxAttempts") ?? ""),
              minScore: String(formData.get("scheduledMinScore") ?? ""),
            });
          }}
          style={{ display: "grid", gap: 10, marginTop: 12 }}
        >
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" name="enabled" defaultChecked={schedule?.enabled ?? false} />
            Enable scheduled auto-apply
          </label>
          <label style={{ fontSize: 12, color: "#555" }}>
            Cron:
            <input
              name="cron"
              defaultValue={schedule?.cron ?? defaultCron}
              style={{
                marginLeft: 8,
                padding: "6px 8px",
                borderRadius: 10,
                border: "1px solid #ddd",
                width: 220,
              }}
            />
          </label>
          <label style={{ fontSize: 12, color: "#555" }}>
            Timezone:
            <input
              name="timezone"
              defaultValue={schedule?.timezone ?? defaultTimezone}
              style={{
                marginLeft: 8,
                padding: "6px 8px",
                borderRadius: 10,
                border: "1px solid #ddd",
                width: 220,
              }}
            />
          </label>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, color: "#555" }}>
              maxAttempts:
              <input
                name="scheduledMaxAttempts"
                defaultValue={schedule?.maxAttempts ?? defaultMaxAttemptsRaw}
                style={{
                  marginLeft: 8,
                  padding: "6px 8px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  width: 90,
                }}
              />
            </label>
            <label style={{ fontSize: 12, color: "#555" }}>
              minScore:
              <input
                name="scheduledMinScore"
                defaultValue={schedule?.minScore ?? defaultMinScoreRaw}
                style={{
                  marginLeft: 8,
                  padding: "6px 8px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  width: 90,
                }}
              />
            </label>
          </div>
          <button style={{ width: "fit-content", padding: "8px 12px" }}>Save schedule</button>
        </form>
        <div style={{ marginTop: 12, fontSize: 12, color: "#777" }}>
          {schedule ? (
            <>
              next run: {new Date(schedule.nextRunAt).toLocaleString()}
              {schedule.lastTriggeredAt
                ? ` · last triggered: ${new Date(schedule.lastTriggeredAt).toLocaleString()}`
                : " · never triggered yet"}
            </>
          ) : (
            <>No saved schedule yet. Default cron is {defaultCron}.</>
          )}
        </div>
      </section>

      <section
        style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 12, padding: 16 }}
      >
        <div style={{ fontWeight: 600 }}>
          Recent totals (last {stats.recent.cycles.length} cycles)
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10, color: "#555" }}>
          <div>discovered: {stats.recent.totals.discovered}</div>
          <div>synced: {stats.recent.totals.synced}</div>
          <div>attemptBudget: {stats.recent.totals.attemptBudget}</div>
          <div>enqueuedAttempts: {stats.recent.totals.enqueuedAttempts}</div>
        </div>
      </section>

      <h2 style={{ marginTop: 24 }}>Recent cycles</h2>
      <div style={{ display: "grid", gap: 12 }}>
        {stats.recent.cycles.map((e) => (
          <section key={e.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontWeight: 600 }}>{getEventLabel(e.type)}</div>
              <div style={{ fontSize: 12, color: "#777" }}>{new Date(e.time).toLocaleString()}</div>
            </div>
            <pre
              style={{
                marginTop: 8,
                padding: 12,
                borderRadius: 12,
                background: "#fafafa",
                overflow: "auto",
                fontSize: 12,
              }}
            >
              {JSON.stringify(e.payload, null, 2)}
            </pre>
          </section>
        ))}

        {stats.recent.cycles.length === 0 ? (
          <div style={{ padding: 16, border: "1px dashed #ccc", borderRadius: 12, color: "#555" }}>
            No cycles yet. Run `POST /auto-apply/run` or set `RUN_AUTO_APPLY_DEMO=1`.
          </div>
        ) : null}
      </div>
    </main>
  );
}
