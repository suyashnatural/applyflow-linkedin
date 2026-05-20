type JobPosting = {
  id: string;
  url: string;
  title: string | null;
  companyName: string | null;
  location: string | null;
  easyApply: boolean;
  score?: number | null;
  scoreReason?: string | null;
};

type ApplicationStep = {
  id: string;
  createdAt: string;
  name: string;
  state: string;
  detail: unknown;
};

type ApplicationAnswer = {
  id: string;
  questionId: string;
  questionLabel: string;
  required: boolean;
  answer: string;
  confidence: number;
  requiresApproval: boolean;
  approved: boolean;
  source: string;
  updatedAt: string;
};

type SubmitReadiness = {
  ready: boolean;
  missingRequired: string[];
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

async function getAnswers(id: string): Promise<ApplicationAnswer[]> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const res = await fetch(`${baseUrl}/applications/${id}/answers`, { cache: "no-store" });
  if (!res.ok) throw new Error(`failed to fetch answers: ${res.status}`);
  const json = (await res.json()) as { answers: ApplicationAnswer[] };
  return json.answers ?? [];
}

async function getReadiness(id: string): Promise<SubmitReadiness> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const res = await fetch(`${baseUrl}/applications/${id}/readiness`, { cache: "no-store" });
  if (!res.ok) throw new Error(`failed to fetch readiness: ${res.status}`);
  const json = (await res.json()) as { readiness: SubmitReadiness };
  return json.readiness;
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
  const answers = await getAnswers(id);
  const readiness = await getReadiness(id);
  const aiStep = application.steps.find((s) => s.name === "AI_DRAFT_ANSWERS");
  const latestNonSuccess = [...application.steps].reverse().find((s) => s.state !== "succeeded");
  const latestReason =
    latestNonSuccess && latestNonSuccess.detail && typeof latestNonSuccess.detail === "object"
      ? ((latestNonSuccess.detail as any).reason ?? (latestNonSuccess.detail as any).error ?? null)
      : null;

  const missingRequired = readiness.missingRequired ?? [];
  const canSubmit = readiness.ready;

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
              {typeof application.jobPosting.score === "number"
                ? ` · score: ${application.jobPosting.score}`
                : ""}
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
              await postJson(`/applications/${application.id}/answers/bulk-approve`, {});
            }}
          >
            <button style={{ padding: "8px 12px" }}>Bulk approve safe answers</button>
          </form>

          <form
            action={async () => {
              "use server";
              if (!canSubmit) return;
              await postJson(`/applications/${application.id}/approve`, {});
            }}
          >
            <button style={{ padding: "8px 12px" }} disabled={!canSubmit}>
              Approve submit
            </button>
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

      {!canSubmit ? (
        <section
          style={{
            marginTop: 16,
            border: "1px solid #f0c36d",
            borderRadius: 12,
            padding: 12,
            background: "#fff9e6",
          }}
        >
          <div style={{ fontWeight: 600 }}>Not ready to submit</div>
          <div style={{ fontSize: 12, color: "#6b4a00" }}>
            Approve answers for required questions (or apply templates) before submitting.
          </div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {missingRequired.slice(0, 20).map((l) => (
              <li key={l} style={{ fontSize: 12 }}>
                {l}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <h2 style={{ marginTop: 24 }}>Answers</h2>
      <div style={{ display: "grid", gap: 12 }}>
        {answers
          .slice()
          .sort(
            (a, b) =>
              Number(b.required) - Number(a.required) ||
              a.questionLabel.localeCompare(b.questionLabel)
          )
          .map((a) => (
            <section key={a.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {a.questionLabel}
                    {a.required ? <span style={{ color: "#b42318" }}> *</span> : null}
                  </div>
                  <div style={{ fontSize: 12, color: "#777" }}>
                    confidence: {Number.isFinite(a.confidence) ? a.confidence.toFixed(2) : "0.00"} ·{" "}
                    source: {a.source}
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: 12, color: "#555" }}>
                  updated: {new Date(a.updatedAt).toLocaleString()}
                </div>
              </div>

              <form
                action={async (formData) => {
                  "use server";
                  const questionId = String(formData.get("questionId") ?? "");
                  const questionLabel = String(formData.get("questionLabel") ?? "");
                  const answer = String(formData.get("answer") ?? "");
                  const approved = formData.get("approved") === "on";
                  const required = formData.get("required") === "on";
                  const requiresApproval = formData.get("requiresApproval") === "on";
                  const saveAsTemplate = formData.get("saveAsTemplate") === "on";
                  const confidence = Number(formData.get("confidence") ?? 0);
                  await postJson(`/applications/${application.id}/answers/upsert`, {
                    questionId,
                    questionLabel,
                    answer,
                    approved,
                    required,
                    requiresApproval,
                    confidence,
                    saveAsTemplate,
                  });
                }}
              >
                <input type="hidden" name="questionId" value={a.questionId} />
                <input type="hidden" name="questionLabel" value={a.questionLabel} />
                <input type="hidden" name="confidence" value={a.confidence} />
                <label style={{ display: "block", marginTop: 8, fontSize: 12, color: "#555" }}>
                  Draft answer
                </label>
                <textarea
                  name="answer"
                  defaultValue={a.answer}
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
                    <input type="checkbox" name="approved" defaultChecked={a.approved} />
                    Approved
                  </label>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                    <input
                      type="checkbox"
                      name="requiresApproval"
                      defaultChecked={a.requiresApproval}
                    />
                    Requires approval
                  </label>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                    <input type="checkbox" name="required" defaultChecked={a.required} />
                    Required
                  </label>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                    <input type="checkbox" name="saveAsTemplate" defaultChecked={false} />
                    Save as template
                  </label>
                  <button style={{ padding: "6px 10px" }}>Save</button>
                </div>
              </form>
            </section>
          ))}

        {answers.length === 0 ? (
          <div style={{ padding: 16, border: "1px dashed #ccc", borderRadius: 12, color: "#555" }}>
            No answers found yet. Run `AI_DRAFT_ANSWERS` for this application.
          </div>
        ) : null}
      </div>

      {latestNonSuccess ? (
        <section
          style={{
            marginTop: 16,
            border: "1px solid #eee",
            borderRadius: 12,
            padding: 12,
            background: "#fafafa",
          }}
        >
          <div style={{ fontWeight: 600 }}>Latest outcome</div>
          <div style={{ fontSize: 12, color: "#555" }}>
            {latestNonSuccess.name} · {latestNonSuccess.state}
            {latestReason ? ` · ${String(latestReason)}` : ""}
          </div>
        </section>
      ) : null}

      <h2 style={{ marginTop: 24 }}>Timeline</h2>
      {aiStep?.detail ? (
        <>
          <h3 style={{ marginTop: 16 }}>AI Draft Answers</h3>
          <pre
            style={{
              marginTop: 8,
              padding: 12,
              borderRadius: 12,
              background: "#fafafa",
              overflow: "auto",
            }}
          >
            {JSON.stringify(aiStep.detail, null, 2)}
          </pre>
        </>
      ) : null}

      {application.steps.some((s) => (s.detail as any)?.artifactDir) ? (
        <>
          <h3 style={{ marginTop: 16 }}>Artifacts</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {application.steps
              .filter((s) => Boolean((s.detail as any)?.artifactDir))
              .map((s) => (
                <div
                  key={`${s.id}-artifact`}
                  style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}
                >
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: "#555" }}>
                    artifactDir: {(s.detail as any).artifactDir}
                  </div>
                </div>
              ))}
          </div>
        </>
      ) : null}
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
