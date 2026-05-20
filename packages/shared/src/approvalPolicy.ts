export function isSensitiveQuestionLabel(label: string): boolean {
  const l = label.toLowerCase();
  return (
    l.includes("salary") ||
    l.includes("compensation") ||
    l.includes("sponsorship") ||
    l.includes("visa") ||
    l.includes("work authorization") ||
    l.includes("authorized") ||
    l.includes("relocat") ||
    l.includes("criminal") ||
    l.includes("disability") ||
    l.includes("gender") ||
    l.includes("race") ||
    l.includes("ethnic") ||
    l.includes("veteran")
  );
}
