type ApplicationListItem = {
  id: string;
  status: string;
  createdAt: string;
  jobPostingId: string;
};

async function getNeedsReview(): Promise<ApplicationListItem[]> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const res = await fetch(`${baseUrl}/applications?status=needs_review`, { cache: "no-store" });
  if (!res.ok) throw new Error(`failed to fetch applications: ${res.status}`);
  const json = (await res.json()) as { applications: ApplicationListItem[] };
  return json.applications ?? [];
}

export default async function Home() {
  const applications = await getNeedsReview();

  return (
    <main style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 8 }}>Needs Review</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        Easy Apply dry-runs that reached the review step.
      </p>

      <div style={{ margin: "12px 0 18px" }}>
        <a href="/templates" style={{ color: "#2563eb", textDecoration: "none", fontSize: 14 }}>
          Manage answer templates →
        </a>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {applications.map((a) => (
          <a
            key={a.id}
            href={`/applications/${a.id}`}
            style={{
              display: "block",
              padding: 16,
              border: "1px solid #e5e5e5",
              borderRadius: 12,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{a.id}</div>
                <div style={{ color: "#555", fontSize: 12 }}>jobPostingId: {a.jobPostingId}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, color: "#555" }}>{a.status}</div>
                <div style={{ fontSize: 12, color: "#777" }}>
                  {new Date(a.createdAt).toLocaleString()}
                </div>
              </div>
            </div>
          </a>
        ))}

        {applications.length === 0 ? (
          <div style={{ padding: 16, border: "1px dashed #ccc", borderRadius: 12, color: "#555" }}>
            No applications need review.
          </div>
        ) : null}
      </div>
    </main>
  );
}
