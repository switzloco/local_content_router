// router.js — Route plugin registry and routing engine

const registry = new Map();

/**
 * A route plugin:
 * {
 *   id:       string,
 *   name:     string,
 *   icon:     string (emoji or short text),
 *   defaultCategories: string[],
 *   route:    async (text, segment) => { success: boolean, message: string }
 * }
 */

export function register(plugin) {
  registry.set(plugin.id, plugin);
}

export function getAll() {
  return [...registry.values()];
}

export function getById(id) {
  return registry.get(id);
}

/**
 * Route a segment to a destination.
 * Uses de-identified text if available and deidentify=true, else original.
 */
export async function route(segment, destinationId, deidentify = true) {
  const plugin = registry.get(destinationId);
  if (!plugin) {
    return { success: false, message: `Unknown destination: ${destinationId}` };
  }

  const text = (deidentify && segment.pii?.length > 0) ? segment.clean : segment.original;

  try {
    return await plugin.route(text, segment);
  } catch (err) {
    return { success: false, message: `Routing failed: ${err.message}` };
  }
}

/**
 * Route all segments to their assigned destinations.
 * Returns array of { segmentId, result }.
 */
export async function routeAll(segments, destinationMap, deidentify = true) {
  const results = [];
  for (const seg of segments) {
    const destId = destinationMap[seg.id] ?? 'clipboard';
    const result = await route(seg, destId, deidentify);
    results.push({ segmentId: seg.id, result });
  }
  return results;
}

/**
 * Build a destination <option> list for select elements.
 */
export function buildDestOptions() {
  return getAll().map(p => ({ id: p.id, name: `${p.icon} ${p.name}` }));
}

/**
 * Register a custom URL destination at runtime.
 */
export function registerCustom({ id, name, urlTemplate }) {
  register({
    id,
    name,
    icon: '🔗',
    defaultCategories: [],
    async route(text) {
      const url = urlTemplate.replace('{{text}}', encodeURIComponent(text));
      window.open(url, '_blank');
      return { success: true, message: `Opened in ${name}` };
    },
  });
}
