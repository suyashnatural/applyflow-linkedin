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

function apiAuthHeaders(): Record<string, string> {
  const key = process.env.WEB_API_KEY;
  return key ? { "x-applyflow-api-key": key } : {};
}

async function getApplication(id: string): Promise<Application> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const res = await fetch(`${baseUrl}/applications/${id}`, {
    cache: "no-store",
    headers: apiAuthHeaders(),
  });
  if (!res.ok) throw new Error(`failed to fetch application: ${res.status}`);
  const json = (await res.json()) as { application: Application };
  return json.application;
}

async function getAnswers(id: string): Promise<ApplicationAnswer[]> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const res = await fetch(`${baseUrl}/applications/${id}/answers`, {
    cache: "no-store",
    headers: apiAuthHeaders(),
  });
  if (!res.ok) throw new Error(`failed to fetch answers: ${res.status}`);
  const json = (await res.json()) as { answers: ApplicationAnswer[] };
  return json.answers ?? [];
}

async function getReadiness(id: string): Promise<SubmitReadiness> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const res = await fetch(`${baseUrl}/applications/${id}/readiness`, {
    cache: "no-store",
    headers: apiAuthHeaders(),
  });
  if (!res.ok) throw new Error(`failed to fetch readiness: ${res.status}`);
  const json = (await res.json()) as { readiness: SubmitReadiness };
  return json.readiness;
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

function getStatusTone(status: string): {
  label: string;
  background: string;
  border: string;
  text: string;
} {
  switch (status) {
    case "submitted":
      return {
        label: "Submitted",
        background: "#edfdf3",
        border: "#abefc6",
        text: "#067647",
      };
    case "failed":
      return {
        label: "Failed",
        background: "#fef3f2",
        border: "#fecdca",
        text: "#b42318",
      };
    case "blocked":
      return {
        label: "Blocked",
        background: "#fff4ed",
        border: "#fdba74",
        text: "#c2410c",
      };
    case "needs_review":
      return {
        label: "Needs Review",
        background: "#fffaeb",
        border: "#fedf89",
        text: "#b54708",
      };
    case "in_progress":
      return {
        label: "In Progress",
        background: "#eff8ff",
        border: "#b2ddff",
        text: "#175cd3",
      };
    default:
      return {
        label: status,
        background: "#f8fafc",
        border: "#d0d5dd",
        text: "#344054",
      };
  }
}

function getLatestReason(application: Application): string | null {
  const latestNonSuccess = [...application.steps].reverse().find((s) => s.state !== "succeeded");
  if (!latestNonSuccess?.detail || typeof latestNonSuccess.detail !== "object") return null;
  return (
    ((latestNonSuccess.detail as any).reason as string | undefined) ??
    ((latestNonSuccess.detail as any).error as string | undefined) ??
    null
  );
}

function getArtifactDir(step: ApplicationStep): string | null {
  if (!step.detail || typeof step.detail !== "object") return null;
  const detail = step.detail as any;
  return typeof detail.artifactDir === "string" ? detail.artifactDir : null;
}

function getPhaseName(stepName: string): string {
  if (stepName.startsWith("AI_")) return "AI";
  if (stepName.includes("HUMAN") || stepName.includes("AUTO_SUBMIT_POLICY")) return "Review";
  if (stepName.includes("SUBMIT")) return "Submit";
  if (stepName.includes("DRY_RUN")) return "Dry Run";
  return "Other";
}

function getFileHref(path: string): string {
  const cleaned = path.startsWith("/") ? path : `/${path}`;
  return cleaned;
}

export default async function ApplicationPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const application = await getApplication(id);
  const answers = await getAnswers(id);
  const readiness = await getReadiness(id);

  const canSubmit = readiness.ready;
  const missingRequired = readiness.missingRequired ?? [];
  const statusTone = getStatusTone(application.status);
  const latestReason = getLatestReason(application);
  const stepGroups = new Map<string, ApplicationStep[]>();

  for (const step of application.steps) {
    const phase = getPhaseName(step.name);
    const items = stepGroups.get(phase) ?? [];
    items.push(step);
    stepGroups.set(phase, items);
  }

  const groupedSteps = [...stepGroups.entries()];
  const artifactSteps = application.steps.filter((step) => Boolean(getArtifactDir(step)));

  return (
    <main style={{ padding: 24, maxWidth: 1040, margin: "0 auto" }}>
      <a href="/" style={{ color: "#555" }}>
        ← Back
      </a>
      <h1 style={{ marginBottom: 8 }}>Application {application.id}</h1>

      <section
        style={{
          border: `1px solid ${statusTone.border}`,
          borderRadius: 16,
          padding: 18,
          background: statusTone.background,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          <div>
            <div
              style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: statusTone.text }}
            >
              {statusTone.label}
            </div>
            <div style={{ fontWeight: 700, fontSize: 20, marginTop: 4 }}>
              {application.jobPosting.title ?? "Untitled"} @{" "}
              {application.jobPosting.companyName ?? "Unknown"}
            </div>
            <div style={{ color: "#475467", fontSize: 13, marginTop: 6 }}>
              {application.jobPosting.location ?? "Location unavailable"}
            </div>
            <div style={{ color: "#475467", fontSize: 13, marginTop: 6 }}>
              <a href={application.jobPosting.url} target="_blank" rel="noreferrer">
                LinkedIn job
              </a>
              {" · "}
              {application.jobPosting.easyApply ? "Easy Apply" : "Not Easy Apply"}
              {typeof application.jobPosting.score === "number"
                ? ` · score: ${application.jobPosting.score}`
                : ""}
            </div>
            {application.jobPosting.scoreReason ? (
              <div style={{ color: "#475467", fontSize: 13, marginTop: 6 }}>
                score rationale: {application.jobPosting.scoreReason}
              </div>
            ) : null}
          </div>

          <div style={{ textAlign: "right", color: "#475467", fontSize: 12 }}>
            <div>created: {new Date(application.createdAt).toLocaleString()}</div>
            <div style={{ marginTop: 4 }}>
              updated: {new Date(application.updatedAt).toLocaleString()}
            </div>
          </div>
        </div>

        {latestReason ? (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 12,
              background: "#ffffffb3",
              border: "1px solid rgba(16, 24, 40, 0.08)",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: "#344054" }}>Latest outcome</div>
            <div style={{ marginTop: 4, fontSize: 14, color: "#344054" }}>{latestReason}</div>
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
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
            Approve answers for required questions or reuse templates before submitting.
          </div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {missingRequired.slice(0, 20).map((label) => (
              <li key={label} style={{ fontSize: 12 }}>
                {label}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section
          style={{
            marginTop: 16,
            border: "1px solid #abefc6",
            borderRadius: 12,
            padding: 12,
            background: "#edfdf3",
            color: "#067647",
          }}
        >
          <div style={{ fontWeight: 600 }}>Ready to submit</div>
          <div style={{ fontSize: 12 }}>
            Required answers are approved and the application can move forward.
          </div>
        </section>
      )}

      {artifactSteps.length > 0 ? (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ marginBottom: 10 }}>Artifacts</h2>
          <div style={{ display: "grid", gap: 10 }}>
            {artifactSteps.map((step) => {
              const artifactDir = getArtifactDir(step)!;
              return (
                <div
                  key={`${step.id}-artifact`}
                  style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {step.name} · {step.state}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>
                    <a href={getFileHref(artifactDir)} target="_blank" rel="noreferrer">
                      {artifactDir}
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section style={{ marginTop: 24 }}>
        <h2 style={{ marginBottom: 10 }}>Answers</h2>
        <div style={{ display: "grid", gap: 12 }}>
          {answers
            .slice()
            .sort(
              (a, b) =>
                Number(b.required) - Number(a.required) ||
                a.questionLabel.localeCompare(b.questionLabel)
            )
            .map((answer) => (
              <section
                key={answer.id}
                style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {answer.questionLabel}
                      {answer.required ? <span style={{ color: "#b42318" }}> *</span> : null}
                    </div>
                    <div style={{ fontSize: 12, color: "#777" }}>
                      confidence:{" "}
                      {Number.isFinite(answer.confidence) ? answer.confidence.toFixed(2) : "0.00"}
                      {" · "}source: {answer.source}
                      {" · "}approved: {answer.approved ? "yes" : "no"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 12, color: "#555" }}>
                    updated: {new Date(answer.updatedAt).toLocaleString()}
                  </div>
                </div>

                <form
                  action={async (formData) => {
                    "use server";
                    const questionId = String(formData.get("questionId") ?? "");
                    const questionLabel = String(formData.get("questionLabel") ?? "");
                    const value = String(formData.get("answer") ?? "");
                    const approved = formData.get("approved") === "on";
                    const required = formData.get("required") === "on";
                    const requiresApproval = formData.get("requiresApproval") === "on";
                    const saveAsTemplate = formData.get("saveAsTemplate") === "on";
                    const confidence = Number(formData.get("confidence") ?? 0);

                    await postJson(`/applications/${application.id}/answers/upsert`, {
                      questionId,
                      questionLabel,
                      answer: value,
                      approved,
                      required,
                      requiresApproval,
                      confidence,
                      saveAsTemplate,
                    });
                  }}
                >
                  <input type="hidden" name="questionId" value={answer.questionId} />
                  <input type="hidden" name="questionLabel" value={answer.questionLabel} />
                  <input type="hidden" name="confidence" value={answer.confidence} />

                  <label style={{ display: "block", marginTop: 8, fontSize: 12, color: "#555" }}>
                    Draft answer
                  </label>
                  <textarea
                    name="answer"
                    defaultValue={answer.answer}
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

                  <div
                    style={{
                      display: "flex",
                      gap: 16,
                      marginTop: 10,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                      <input type="checkbox" name="approved" defaultChecked={answer.approved} />
                      Approved
                    </label>
                    <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                      <input
                        type="checkbox"
                        name="requiresApproval"
                        defaultChecked={answer.requiresApproval}
                      />
                      Requires approval
                    </label>
                    <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                      <input type="checkbox" name="required" defaultChecked={answer.required} />
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
            <div
              style={{ padding: 16, border: "1px dashed #ccc", borderRadius: 12, color: "#555" }}
            >
              No answers found yet. Run `AI_DRAFT_ANSWERS` for this application.
            </div>
          ) : null}
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ marginBottom: 10 }}>Timeline</h2>
        <div style={{ display: "grid", gap: 16 }}>
          {groupedSteps.map(([phase, steps]) => (
            <section
              key={phase}
              style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 14 }}
            >
              <div style={{ fontWeight: 700, marginBottom: 10 }}>{phase}</div>
              <div style={{ display: "grid", gap: 10 }}>
                {steps.map((step) => (
                  <div
                    key={step.id}
                    style={{ border: "1px solid #f2f4f7", borderRadius: 12, padding: 12 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ fontWeight: 600 }}>
                        {step.name} · {step.state}
                      </div>
                      <div style={{ fontSize: 12, color: "#777" }}>
                        {new Date(step.createdAt).toLocaleString()}
                      </div>
                    </div>

                    {getArtifactDir(step) ? (
                      <div style={{ marginTop: 8, fontSize: 12 }}>
                        artifact:{" "}
                        <a
                          href={getFileHref(getArtifactDir(step)!)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {getArtifactDir(step)}
                        </a>
                      </div>
                    ) : null}

                    {step.detail ? (
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
                        {JSON.stringify(step.detail, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}
