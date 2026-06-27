/**
 * Does the granted scope set satisfy a single required scope?
 * Exact match always works. A granted scope ending in `:*` covers anything under
 * that prefix (`email:*` satisfies `email:read`), and `*` covers everything.
 */
export function scopeSatisfied(granted: string[], required: string): boolean {
  for (const g of granted) {
    if (g === required || g === '*') return true;
    if (g.endsWith(':*') && required.startsWith(g.slice(0, -1))) return true;
  }
  return false;
}

export function missingScopes(granted: string[], required: string[]): string[] {
  return required.filter((r) => !scopeSatisfied(granted, r));
}
