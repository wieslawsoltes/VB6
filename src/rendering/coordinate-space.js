/** Display transforms do not change authored coordinates. Read the complete
 * axis-aligned transform (workspace density, designer zoom and host scaling)
 * from materialized geometry, instead of assuming one particular zoom owner.
 * A caller can share its current measurement; never cache it across layouts. */
export function displayScale(element, fallback = 1, bounds = element.getBoundingClientRect()) {
  const valid = n => Number.isFinite(n) && n > 0 ? n : fallback;
  return {x: valid(bounds.width / element.offsetWidth), y: valid(bounds.height / element.offsetHeight)};
}
export function localPoint(element, clientX, clientY) {
  const bounds = element.getBoundingClientRect(), scale = displayScale(element, 1, bounds);
  return {x: (clientX - bounds.left) / scale.x - element.clientLeft + element.scrollLeft,
    y: (clientY - bounds.top) / scale.y - element.clientTop + element.scrollTop};
}
