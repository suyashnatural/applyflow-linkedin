type AuditEvent = {
  id: string;
  time: string;
  type: string;
  accountId: string | null;
  applicationId: string | null;
  jobPostingId: string | null;
  payload: unknown;
};

function apiAuthHeaders(): Record<string, string> {
  const key = process.env.WEB_API_KEY;
  return key ? { "x-applyflow-api-key": key } : {};
}

async function getAuditEvents(accountId: string): Promise<AuditEvent[]> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const res = await fetch(`${baseUrl}/audit?accountId=${encodeURIComponent(accountId)}&limit=100`, {
    cache: "no-store",
    headers: apiAuthHeaders(),
  });
  if (!res.ok) throw new Error(`failed to fetch audit events: ${res.status}`);
  const json = (await res.json()) as { events: AuditEvent[] };
  return json.events ?? [];
}

function getAuditLabel(type: string): string {
  switch (type) {
    case "OPERATOR_NOTIFICATION_READ":
      return "Notification read";
    case "OPERATOR_NOTIFICATION_DISMISSED":
      return "Notification dismissed";
    case "OPERATOR_SESSION_RECOVERY_TRIGGERED":
      return "Session recovery triggered";
    case "OPERATOR_AUTO_APPLY_TRIGGERED":
      return "Auto-apply triggered";
    case "OPERATOR_ANSWER_UPSERTED":
      return "Answer updated";
    case "OPERATOR_BULK_APPROVED":
      return "Bulk approve";
    case "OPERATOR_APPLICATION_APPROVED":
      return "Application approved";
    case "OPERATOR_APPLICATION_DENIED":
      return "Application denied";
    default:
      return type;
  }
}

export default async function AuditPage(props: { searchParams: Promise<{ accountId?: string }> }) {
  const sp = await props.searchParams;
  const accountId = sp.accountId ?? process.env.LINKEDIN_ACCOUNT_ID ?? "default";
  const events = await getAuditEvents(accountId);

  return (
    <main style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <a href={`/dashboard?accountId=${encodeURIComponent(accountId)}`} style={{ color: "#555" }}>
        ← Back
      </a>
      <h1 style={{ marginBottom: 8 }}>Audit Trail</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        Recent operator actions for account `{accountId}`.
      </p>

      <div style={{ display: "grid", gap: 12 }}>
        {events.map((event) => (
          <section
            key={event.id}
            style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{getAuditLabel(event.type)}</div>
                <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
                  {event.applicationId ? (
                    <a
                      href={`/applications/${event.applicationId}`}
                      style={{ color: "#2563eb", textDecoration: "none" }}
                    >
                      application {event.applicationId}
                    </a>
                  ) : (
                    <>account {event.accountId ?? "unknown"}</>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "#777" }}>
                {new Date(event.time).toLocaleString()}
              </div>
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
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </section>
        ))}

        {events.length === 0 ? (
          <div style={{ padding: 16, border: "1px dashed #ccc", borderRadius: 12, color: "#555" }}>
            No operator actions recorded yet.
          </div>
        ) : null}
      </div>
    </main>
  );
}
