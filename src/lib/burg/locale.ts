export const BURG_LANGUAGES = [
  "de",
  "en",
  "it",
] as const;

export type BurgLanguage =
  (typeof BURG_LANGUAGES)[number];

/**
 * Preserve the exact language-selection semantics
 * previously duplicated across every Astro page.
 */
export function resolveBurgLanguage(
  acceptLanguage: string | null | undefined,
): BurgLanguage {
  const header =
    acceptLanguage || "de";

  const prefs = header
    .toLowerCase()
    .split(",")
    .map(
      (part) =>
        part.trim().substring(0, 2),
    );

  return (
    prefs.find(
      (candidate) =>
        BURG_LANGUAGES.includes(
          candidate as BurgLanguage,
        ),
    ) as BurgLanguage | undefined
  ) || "de";
}
