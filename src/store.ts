export interface RevocationStore {
  /** Mark a token (by jti) revoked until its natural expiry (unix seconds). */
  revoke(jti: string, expiresAt: number): Promise<void> | void;
  isRevoked(jti: string): Promise<boolean> | boolean;
}

// ponytail: in-memory default; swap for Redis/DB via the RevocationStore interface when you need
// revocation to survive restarts or span multiple processes.
export class MemoryStore implements RevocationStore {
  private revoked = new Map<string, number>();

  revoke(jti: string, expiresAt: number): void {
    this.revoked.set(jti, expiresAt);
  }

  isRevoked(jti: string): boolean {
    const expiresAt = this.revoked.get(jti);
    if (expiresAt === undefined) return false;
    // Past natural expiry the token is already invalid — drop the entry to bound memory.
    if (expiresAt * 1000 < Date.now()) {
      this.revoked.delete(jti);
      return false;
    }
    return true;
  }
}
