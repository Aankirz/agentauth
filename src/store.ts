/** What to revoke. Match is AND across the provided fields; an empty object matches nothing. */
export interface RevocationCriteria {
  jti?: string;
  agent?: string;
  subject?: string;
}

/** The subset of claims revocation is checked against. */
export interface RevocationSubject {
  jti: string;
  agent: string;
  subject: string;
}

export interface RevocationStore {
  /** Record a revocation, valid until `expiresAt` (unix seconds). */
  revoke(criteria: RevocationCriteria, expiresAt: number): Promise<void> | void;
  isRevoked(claims: RevocationSubject): Promise<boolean> | boolean;
}

function isEmpty(c: RevocationCriteria): boolean {
  return c.jti === undefined && c.agent === undefined && c.subject === undefined;
}

function matches(c: RevocationCriteria, claims: RevocationSubject): boolean {
  if (isEmpty(c)) return false;
  return (
    (c.jti === undefined || c.jti === claims.jti) &&
    (c.agent === undefined || c.agent === claims.agent) &&
    (c.subject === undefined || c.subject === claims.subject)
  );
}

// ponytail: in-memory default; swap for Redis/DB via the RevocationStore interface when
// revocation must survive restarts or span processes.
export class MemoryStore implements RevocationStore {
  private entries: Array<{ criteria: RevocationCriteria; expiresAt: number }> = [];

  revoke(criteria: RevocationCriteria, expiresAt: number): void {
    if (isEmpty(criteria)) return;
    this.entries.push({ criteria, expiresAt });
  }

  isRevoked(claims: RevocationSubject): boolean {
    const now = Date.now();
    // Evict entries past their expiry so memory stays bounded.
    this.entries = this.entries.filter((e) => e.expiresAt * 1000 >= now);
    return this.entries.some((e) => matches(e.criteria, claims));
  }
}
