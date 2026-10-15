export const BURG_LANGUAGES = [
  "de",
  "en",
  "it",
] as const;

export type BurgLanguage =
  (typeof BURG_LANGUAGES)[number];

/** Resolve supported languages by their Accept-Language quality weights. */
export function resolveBurgLanguage(acceptLanguage: string | null | undefined): BurgLanguage {
  const preferences = (acceptLanguage || '').toLowerCase().split(',').map((part, order) => {
    const [tag, ...parameters] = part.trim().split(';');
    const quality = parameters.map(parameter => parameter.trim()).find(parameter => parameter.startsWith('q='));
    const weight = quality === undefined ? 1 : Number(quality.slice(2));
    return { language: tag.split('-')[0], weight, order };
  }).filter(({ language, weight }) =>
    BURG_LANGUAGES.includes(language as BurgLanguage) && Number.isFinite(weight) && weight > 0 && weight <= 1
  ).sort((a, b) => b.weight - a.weight || a.order - b.order);
  return preferences[0]?.language as BurgLanguage || 'de';
}
