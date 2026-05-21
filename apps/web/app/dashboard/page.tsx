import { getApplicationOutcomePresentation } from "@applyflow/shared";

type AutoApplyCycleEvent = {
  id: string;
  time: string;
  type: string;
  payload: unknown;
};

type AutoApplyStats = {
  accountId: string;
  today: { cycles: number; submitted: number; blocked: number; needsReview: number };
  recent: {
    cycles: AutoApplyCycleEvent[];
    totals: { discovered: number; synced: number; attemptBudget: number; enqueuedAttempts: number };
  };
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

  const defaultMaxAttemptsRaw = process.env.AUTO_APPLY_TOP_N ?? "5";
  const defaultMinScoreRaw = process.env.AUTO_APPLY_MIN_SCORE ?? "70";
  const defaultCron = process.env.AUTO_APPLY_SCHEDULE_DEFAULT_CRON ?? "0 */4 * * *";
  const defaultTimezone = process.env.AUTO_APPLY_SCHEDULE_DEFAULT_TIMEZONE ?? "UTC";
  const submittedTone = getApplicationOutcomePresentation("submitted");
  const blockedTone = getApplicationOutcomePresentation("blocked_checkpoint");
  const reviewTone = getApplicationOutcomePresentation("needs_answers");

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
            action={async () => {
              "use server";
              await postJson(`/accounts/${encodeURIComponent(accountId)}/bootstrap-session`, {});
            }}
          >
            <button style={{ padding: "8px 12px" }}>Bootstrap session</button>
          </form>

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
            <button style={{ padding: "8px 12px" }}>Run auto-apply cycle now</button>
          </form>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "#777" }}>
          Tip: refresh the page after triggering a job to see new events and counts.
        </div>
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
