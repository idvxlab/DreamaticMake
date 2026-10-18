import english from "./locales/en.json";
export type Language = "zh" | "en";
const messages: Record<string, string> = english;
/** Translate application messages; unknown content stays in its original language. */
export function translate(
  source: string,
  language: Language,
  values?: Record<string | number, string | number>,
) {
  if (!source) return source;
  const key = source.replace(/\s+/g, " ").trim();
  let text = language === "en" ? (messages[key] ?? source) : source;
  if (values)
    text = text.replace(/\{(\d+|\w+)\}/g, (match, name) =>
      String(values[name] ?? match),
    );
  return text;
}
