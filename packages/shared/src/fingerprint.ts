export function fingerprintQuestionLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

