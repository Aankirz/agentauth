export type AgentAuthErrorCode =
  | 'invalid_config'
  | 'invalid_grant'
  | 'token_invalid'
  | 'token_expired'
  | 'token_revoked'
  | 'missing_scope';

export class AgentAuthError extends Error {
  constructor(
    message: string,
    public readonly code: AgentAuthErrorCode,
  ) {
    super(message);
    this.name = 'AgentAuthError';
  }
}

export class InvalidConfigError extends AgentAuthError {
  constructor(message: string) {
    super(message, 'invalid_config');
    this.name = 'InvalidConfigError';
  }
}

export class InvalidGrantError extends AgentAuthError {
  constructor(message: string) {
    super(message, 'invalid_grant');
    this.name = 'InvalidGrantError';
  }
}

export class TokenInvalidError extends AgentAuthError {
  constructor(message = 'token is invalid') {
    super(message, 'token_invalid');
    this.name = 'TokenInvalidError';
  }
}

export class TokenExpiredError extends AgentAuthError {
  constructor(message = 'token has expired') {
    super(message, 'token_expired');
    this.name = 'TokenExpiredError';
  }
}

export class RevokedError extends AgentAuthError {
  constructor(message = 'token has been revoked') {
    super(message, 'token_revoked');
    this.name = 'RevokedError';
  }
}

export class MissingScopeError extends AgentAuthError {
  // Generic message so a token-bearing agent can't read off which scopes to escalate to.
  // The `missing` field is for server-side logging — do not surface it in agent-facing responses.
  constructor(public readonly missing: readonly string[]) {
    super('insufficient scope', 'missing_scope');
    this.name = 'MissingScopeError';
  }
}
