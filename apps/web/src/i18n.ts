import { useSyncExternalStore } from "react";
import { translate, type Language } from "../../../packages/core/src/language";
export type { Language } from "../../../packages/core/src/language";
const listeners = new Set<() => void>();
let language: Language = "zh";
try {
  if (
    typeof window !== "undefined" &&
    window.localStorage.getItem("make-language") === "en"
  )
    language = "en";
} catch {
  /* Storage can be unavailable. */
}
export function setLanguage(value: string) {
  const next: Language = value === "en" ? "en" : "zh";
  if (typeof document !== "undefined") {
    document.documentElement.lang = next === "en" ? "en" : "zh-CN";
    document.title =
      next === "en"
        ? "DreamaticMake · Ideas into objects"
        : "DreamaticMake · 从想法到实物";
  }
  try {
    if (typeof window !== "undefined")
      window.localStorage.setItem("make-language", next);
  } catch {
    /* Server settings remain authoritative. */
  }
  if (next === language) return;
  language = next;
  listeners.forEach((notify) => notify());
}
export const getLanguage = () => language;
export function useLanguage() {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    getLanguage,
    () => "zh" as Language,
  );
}
/** Translate application-owned labels only; project content is never machine-translated. */
export function t(
  source: string,
  values?: Record<string | number, string | number>,
) {
  return translate(source, language, values);
}
