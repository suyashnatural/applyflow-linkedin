type AnswerTemplate = {
  id: string;
  createdAt: string;
  updatedAt: string;
  accountId: string | null;
  fingerprint: string;
  answer: string;
  approved: boolean;
};

function apiAuthHeaders(): Record<string, string> {
  const key = process.env.WEB_API_KEY;
  return key ? { "x-applyflow-api-key": key } : {};
}

async function getTemplates(accountId?: string): Promise<AnswerTemplate[]> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  const res = await fetch(`${baseUrl}/templates${qs}`, {
    cache: "no-store",
    headers: apiAuthHeaders(),
  });
  if (!res.ok) throw new Error(`failed to fetch templates: ${res.status}`);
  const json = (await res.json()) as { templates: AnswerTemplate[] };
  return json.templates ?? [];
}

async function postJson(path: string, body: unknown): Promise<void> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...apiAuthHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
}

export default async function TemplatesPage(props: {
  searchParams: Promise<{ accountId?: string }>;
}) {
  const sp = await props.searchParams;
  const accountId = sp.accountId;
  const templates = await getTemplates(accountId);

  return (
    <main style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <a href="/" style={{ color: "#555" }}>
        ← Back
      </a>
      <h1 style={{ marginBottom: 8 }}>Answer Templates</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        Templates are reused across applications via normalized question label fingerprints.
      </p>

      <form method="GET" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <label style={{ fontSize: 12, color: "#555" }}>
          accountId:
          <input
            name="accountId"
            defaultValue={accountId ?? ""}
            placeholder="(optional)"
            style={{
              marginLeft: 8,
              padding: "6px 8px",
              borderRadius: 10,
              border: "1px solid #ddd",
              width: 360,
            }}
          />
        </label>
        <button style={{ padding: "6px 10px" }}>Filter</button>
        <a href="/templates" style={{ fontSize: 12, color: "#555" }}>
          Clear
        </a>
      </form>

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {templates.map((t) => (
          <section key={t.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{t.fingerprint}</div>
                <div style={{ fontSize: 12, color: "#777" }}>
                  id: {t.id}
                  {" · "}accountId: {t.accountId ?? "global"}
                  {" · "}updated: {new Date(t.updatedAt).toLocaleString()}
                </div>
              </div>
              <div style={{ fontSize: 12, color: t.approved ? "#067647" : "#b42318" }}>
                {t.approved ? "approved" : "not approved"}
              </div>
            </div>

            <form
              action={async (formData) => {
                "use server";
                const answer = String(formData.get("answer") ?? "");
                const approved = formData.get("approved") === "on";
                await postJson(`/templates/${t.id}/update`, { answer, approved });
              }}
            >
              <label style={{ display: "block", marginTop: 8, fontSize: 12, color: "#555" }}>
                Answer
              </label>
              <textarea
                name="answer"
                defaultValue={t.answer}
                rows={4}
                style={{
                  marginTop: 6,
                  width: "100%",
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  fontFamily: "inherit",
                }}
              />
              <div style={{ display: "flex", gap: 16, marginTop: 10, alignItems: "center" }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                  <input type="checkbox" name="approved" defaultChecked={t.approved} />
                  Approved
                </label>
                <button style={{ padding: "6px 10px" }}>Save</button>
              </div>
            </form>

            <form
              action={async () => {
                "use server";
                await postJson(`/templates/${t.id}/delete`, {});
              }}
              style={{ marginTop: 10 }}
            >
              <button style={{ padding: "6px 10px", color: "#b42318" }}>Delete</button>
            </form>
          </section>
        ))}

        {templates.length === 0 ? (
          <div style={{ padding: 16, border: "1px dashed #ccc", borderRadius: 12, color: "#555" }}>
            No templates found.
          </div>
        ) : null}
      </div>
    </main>
  );
}
