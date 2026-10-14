// The words a template can hold that are filled in when something is made
// from it:
//
//   {{title}}    the name of the new scene or entry
//   {{date}}     today, as YYYY-MM-DD
//   {{project}}  the title of the project
//
// Capitals and spaces inside the braces do not matter ("{{ Title }}"). Any
// other word in double braces is left exactly as it is written, so that a
// template can hold text meant for another plugin.

/** What the placeholders stand for. */
export interface PlaceholderValues {
  readonly title: string;
  /** Today, as YYYY-MM-DD. */
  readonly date: string;
  readonly project: string;
}

const PLACEHOLDER = /\{\{\s*(title|date|project)\s*\}\}/gi;

/** A text with its placeholders filled in. */
export function fillPlaceholders(text: string, values: PlaceholderValues): string {
  return text.replace(PLACEHOLDER, (_whole, word: string) => {
    const key = word.toLowerCase() as keyof PlaceholderValues;
    return values[key];
  });
}

/**
 * A property's value with the placeholders in every text inside it filled
 * in: a text, or the texts in a list or a group of properties. Numbers, true
 * and false and empty values are given back as they are. Always a copy.
 */
export function fillValue(value: unknown, values: PlaceholderValues): unknown {
  if (typeof value === 'string') return fillPlaceholders(value, values);
  if (Array.isArray(value)) return value.map((item) => fillValue(item, values));
  if (typeof value === 'object' && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) copy[key] = fillValue(inner, values);
    return copy;
  }
  return value;
}
