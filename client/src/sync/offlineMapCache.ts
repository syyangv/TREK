/**
 * Runtime prerequisites for an offline map prefetch.
 *
 * Cache Storage alone is not enough: MapLibre/Leaflet requests only reach the
 * Workbox runtime caches after a service worker has taken control of the page.
 * Keeping this check in one place prevents a prefetch from recording a bbox that
 * the active map cannot actually serve offline.
 */
export function hasControllingServiceWorker(): boolean {
  return (
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator && Boolean(navigator.serviceWorker.controller)
  );
}
