type QueueJob = {
  id: string;
  createdAt: string;
  updatedAt: string;
  type: string;
  status: string;
  priority: number;
  runAfter: string;
  attempts: number;
  maxAttempts: number;
  runId: string;
  accountId: string | null;
  jobPostingId: string | null;
  applicationId: string | null;
  error: string | null;
};

function apiAuthHeaders(): Record<string, string> {
  const key = process.env.WEB_API_KEY;
  return key ? { "x-applyflow-api-key": key } : {};
}

async function getJobs(status?: string): Promise<QueueJob[]> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await fetch(`${baseUrl}/queue/jobs${qs}`, {
    cache: "no-store",
    headers: apiAuthHeaders(),
  });
  if (!res.ok) throw new Error(`failed to fetch jobs: ${res.status}`);
  const json = (await res.json()) as { jobs: QueueJob[] };
  return json.jobs ?? [];
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

export default async function QueuePage(props: { searchParams: Promise<{ status?: string }> }) {
  const sp = await props.searchParams;
  const status = sp.status;
  const jobs = await getJobs(status);

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <a href="/dashboard" style={{ color: "#555" }}>
        ← Back
      </a>
      <h1 style={{ marginBottom: 8 }}>Queue</h1>

      <form method="GET" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <label style={{ fontSize: 12, color: "#555" }}>
          status:
          <input
            name="status"
            defaultValue={status ?? ""}
            placeholder="queued|running|failed|succeeded|canceled"
            style={{
              marginLeft: 8,
              padding: "6px 8px",
              borderRadius: 10,
              border: "1px solid #ddd",
              width: 320,
            }}
          />
        </label>
        <button style={{ padding: "6px 10px" }}>Filter</button>
        <a href="/queue" style={{ fontSize: 12, color: "#555" }}>
          Clear
        </a>
      </form>

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {jobs.map((j) => (
          <section key={j.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {j.type} · {j.status}
                </div>
                <div style={{ fontSize: 12, color: "#777" }}>
                  id: {j.id}
                  {" · "}priority: {j.priority}
                  {" · "}attempts: {j.attempts}/{j.maxAttempts}
                </div>
                <div style={{ fontSize: 12, color: "#777" }}>
                  runAfter: {new Date(j.runAfter).toLocaleString()}
                  {" · "}created: {new Date(j.createdAt).toLocaleString()}
                </div>
                <div style={{ fontSize: 12, color: "#777" }}>
                  accountId: {j.accountId ?? "-"}
                  {" · "}applicationId: {j.applicationId ?? "-"}
                  {" · "}jobPostingId: {j.jobPostingId ?? "-"}
                </div>
                {j.error ? (
                  <div style={{ fontSize: 12, color: "#b42318", marginTop: 6 }}>
                    error: {j.error}
                  </div>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <form
                  action={async () => {
                    "use server";
                    if (j.status !== "queued" && j.status !== "running") return;
                    await postJson(`/queue/jobs/${j.id}/cancel`, {});
                  }}
                >
                  <button
                    style={{ padding: "6px 10px", color: "#b42318" }}
                    disabled={j.status !== "queued" && j.status !== "running"}
                  >
                    Cancel
                  </button>
                </form>
              </div>
            </div>
          </section>
        ))}

        {jobs.length === 0 ? (
          <div style={{ padding: 16, border: "1px dashed #ccc", borderRadius: 12, color: "#555" }}>
            No jobs found.
          </div>
        ) : null}
      </div>
    </main>
  );
}
