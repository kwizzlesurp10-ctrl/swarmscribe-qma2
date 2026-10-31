const KEY = "swarmscribe:fusions";

/**
 * @returns {Record<string, unknown>[]}
 */
export function loadFusions() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {Record<string, unknown>[]} list
 */
export function saveFusions(list) {
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, 40)));
}

/**
 * @param {Record<string, unknown>} fusion
 */
export function addFusion(fusion) {
  const list = loadFusions().filter((f) => f.id !== fusion.id);
  list.unshift({ ...fusion, savedAt: new Date().toISOString() });
  saveFusions(list);
  return list;
}

/**
 * @param {string} id
 */
export function removeFusion(id) {
  const list = loadFusions().filter((f) => f.id !== id);
  saveFusions(list);
  return list;
}
