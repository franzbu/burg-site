/**
 * Browser-facing endpoints only.
 *
 * Infrastructure addresses (.35/.62) deliberately
 * do not leak into frontend page code.
 */
export const BURG_ENDPOINTS = {
  status:
    "/api/status",

  temperature:
    "/api/temperature",

  panoramaGallery:
    "https://burg-upload-proxy.csaa6335.workers.dev",

  panoramaTile:
    "https://burg-proxy.gitor.uk",
} as const;


export function temperatureHistoryUrl(
  entityId: string,
): string {
  const params =
    new URLSearchParams({
      entity_id: entityId,
    });

  return (
    `${BURG_ENDPOINTS.temperature}`
    + `?${params.toString()}`
  );
}
