type JobPosting = {
  id: string;
  url: string;
  title: string | null;
  companyName: string | null;
  location: string | null;
  easyApply: boolean;
};

type ApplicationStep = {
  id: string;
  createdAt: string;
  name: string;
  state: string;
  detail: unknown;
};

type Application = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  accountId: string;
  jobPostingId: string;
  jobPosting: JobPosting;
  steps: ApplicationStep[];
};

async function getApplication(id: string): Promise<Application> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const res = await fetch(`${baseUrl}/applications/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`failed to fetch application: ${res.status}`);
  const json = (await res.json()) as { application: Application };
  return json.application;
}

async function postJson(path: string, body: unknown): Promise<void> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
}

export default async function ApplicationPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const application = await getApplication(id);

  return (
    <main style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <a href="/" style={{ color: "#555" }}>
        ← Back
      </a>
      <h1 style={{ marginBottom: 8 }}>Application {application.id}</h1>

      <section style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 600 }}>
              {application.jobPosting.title ?? "Untitled"} @{" "}
              {application.jobPosting.companyName ?? "Unknown"}
            </div>
            <div style={{ color: "#555", fontSize: 12 }}>
              {application.jobPosting.location ?? ""}
            </div>
            <div style={{ color: "#555", fontSize: 12 }}>
              <a href={application.jobPosting.url} target="_blank" rel="noreferrer">
                LinkedIn job
              </a>
              {" · "}
              {application.jobPosting.easyApply ? "Easy Apply" : "Not Easy Apply"}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, color: "#555" }}>{application.status}</div>
            <div style={{ fontSize: 12, color: "#777" }}>
              {new Date(application.createdAt).toLocaleString()}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <form
            action={async () => {
              "use server";
              await postJson(`/applications/${application.id}/approve`, {});
            }}
          >
            <button style={{ padding: "8px 12px" }}>Approve submit</button>
          </form>

          <form
            action={async () => {
              "use server";
              await postJson(`/applications/${application.id}/deny`, { reason: "not_interested" });
            }}
          >
            <button style={{ padding: "8px 12px" }}>Deny</button>
          </form>
        </div>
      </section>

      <h2 style={{ marginTop: 24 }}>Timeline</h2>
      <div style={{ display: "grid", gap: 12 }}>
        {application.steps.map((s) => (
          <div key={s.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontWeight: 600 }}>
                {s.name} · {s.state}
              </div>
              <div style={{ fontSize: 12, color: "#777" }}>
                {new Date(s.createdAt).toLocaleString()}
              </div>
            </div>
            {s.detail ? (
              <pre
                style={{
                  marginTop: 8,
                  padding: 12,
                  borderRadius: 12,
                  background: "#fafafa",
                  overflow: "auto",
                }}
              >
                {JSON.stringify(s.detail, null, 2)}
              </pre>
            ) : null}
          </div>
        ))}
      </div>
    </main>
  );
}
