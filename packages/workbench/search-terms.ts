const aliases: [RegExp, string[]][] = [
  [/红外|infrared|\bpir\b/i, ["红外", "infrared", "pir"]],
  [/人体|在场|presence|motion/i, ["人体", "presence", "motion"]],
  [/接近|proximity/i, ["接近", "proximity"]],
  [/距离|distance/i, ["距离", "distance"]],
  [/蜂鸣|buzzer/i, ["蜂鸣", "buzzer"]],
  [/显示|屏幕|display|oled/i, ["显示", "display", "oled"]],
  [/按键|轻触|tactile/i, ["按键", "轻触", "tactile"]],
];
export function relaxedSearchTerms(query: string) {
  if (!/^[\p{L}\p{N}\s._-]+$/u.test(query)) return [];
  const words = query.toLowerCase().match(/[a-z0-9][a-z0-9._-]{1,}/g) || [];
  const expanded = aliases
    .filter(([pattern]) => pattern.test(query))
    .flatMap(([, values]) => values);
  return [...new Set([...words, ...expanded])].slice(0, 12);
}
