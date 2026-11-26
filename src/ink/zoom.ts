/** Current page zoom (the fixed-width page is scaled down in narrow windows). */
let zoom = 1
const listeners = new Set<() => void>()

export function getPageZoom() {
  return zoom
}

export function setPageZoom(z: number) {
  if (z === zoom) return
  zoom = z
  listeners.forEach((l) => l())
}

export function onPageZoom(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
