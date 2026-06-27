export interface Grant {
  /** The human/principal delegating authority. */
  subject: string;
  /** Identifier of the agent receiving authority. */
  agent: string;
  /** Permissions granted, e.g. "email:read". */
  scopes: string[];
  /** Token lifetime in seconds; defaults to the AgentAuth config. */
  ttlSeconds?: number;
}

export interface AgentClaims {
  sub: string;
  agent: string;
  scopes: string[];
  jti: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export interface VerifyOptions {
  /** Scopes the caller must hold; verify() throws if any are missing. */
  requiredScopes?: string[];
}
