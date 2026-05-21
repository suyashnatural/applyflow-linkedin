export type ApplicationOutcomeKind =
  | "ready_to_submit"
  | "needs_answers"
  | "blocked_login"
  | "blocked_checkpoint"
  | "submit_failed"
  | "submitted"
  | "canceled"
  | "in_progress"
  | "queued";

export function classifyApplicationOutcome(params: {
  status: string;
  readinessReady?: boolean;
  latestReason?: string | null;
}): ApplicationOutcomeKind {
  const reason = (params.latestReason ?? "").toLowerCase();

  if (params.status === "submitted") return "submitted";
  if (params.status === "canceled") return "canceled";
  if (params.status === "in_progress") return "in_progress";
  if (params.status === "queued") return "queued";

  if (params.status === "blocked") {
    if (reason.includes("login_required") || reason.includes("login required")) {
      return "blocked_login";
    }
    return "blocked_checkpoint";
  }

  if (params.status === "needs_review") {
    return params.readinessReady ? "ready_to_submit" : "needs_answers";
  }

  if (params.status === "failed") {
    if (reason.includes("missing approved required answers")) {
      return "needs_answers";
    }
    return "submit_failed";
  }

  return "queued";
}

export function getApplicationOutcomePresentation(kind: ApplicationOutcomeKind): {
  label: string;
  summary: string;
  background: string;
  border: string;
  text: string;
} {
  switch (kind) {
    case "submitted":
      return {
        label: "Submitted",
        summary: "The application was sent successfully.",
        background: "#edfdf3",
        border: "#abefc6",
        text: "#067647",
      };
    case "canceled":
      return {
        label: "Canceled",
        summary: "This application was intentionally stopped.",
        background: "#f9fafb",
        border: "#d0d5dd",
        text: "#344054",
      };
    case "blocked_login":
      return {
        label: "Blocked: Login Required",
        summary: "LinkedIn needs the account session to be re-authenticated.",
        background: "#fff4ed",
        border: "#fdba74",
        text: "#c2410c",
      };
    case "blocked_checkpoint":
      return {
        label: "Blocked: Checkpoint",
        summary: "LinkedIn interrupted the flow and needs human intervention.",
        background: "#fff4ed",
        border: "#fdba74",
        text: "#c2410c",
      };
    case "needs_answers":
      return {
        label: "Needs Answers",
        summary: "Required answers still need approval or manual completion.",
        background: "#fffaeb",
        border: "#fedf89",
        text: "#b54708",
      };
    case "ready_to_submit":
      return {
        label: "Ready To Submit",
        summary: "Required answers are approved and the application can move forward.",
        background: "#ecfdf3",
        border: "#a6f4c5",
        text: "#027a48",
      };
    case "submit_failed":
      return {
        label: "Submit Failed",
        summary: "The automation reached an error and needs investigation.",
        background: "#fef3f2",
        border: "#fecdca",
        text: "#b42318",
      };
    case "in_progress":
      return {
        label: "In Progress",
        summary: "The automation is actively working on this application.",
        background: "#eff8ff",
        border: "#b2ddff",
        text: "#175cd3",
      };
    case "queued":
    default:
      return {
        label: "Queued",
        summary: "The application is waiting for the next worker step.",
        background: "#f8fafc",
        border: "#d0d5dd",
        text: "#344054",
      };
  }
}
