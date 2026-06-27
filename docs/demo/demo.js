// AgentAuth playground — the REAL auth logic, ported to run client-side.
// No backend: jose signs/verifies HS256 JWTs in your browser.
import {
  SignJWT,
  jwtVerify,
  decodeJwt,
  errors as joseErrors,
} from 'https://esm.sh/jose@5';

/* =========================================================================
 * Pixel watchdog — copied verbatim from ../app.js so the demo dog matches.
 * ========================================================================= */
const DOG_COLORS = {
  K: 'var(--ink)',
  F: 'var(--amber)',
  f: 'var(--amber-deep)',
  M: 'oklch(91% 0.05 80)',
  W: 'var(--paper)',
  T: 'var(--red)',
  C: 'var(--green)',
  B: 'var(--sky)',
};

const DOG = [
  '.KK........KK...',
  '.KfK......KfK...',
  '.KFfK....KFfK...',
  '.KFFfKKKKFFfK...',
  '..KFFFFFFFFFK...',
  '.KFFFFFFFFFFFK..',
  '.KFFFFFFFFFFFK..',
  '.KFWKFFFFFWKFFK.',
  '.KFWKFFFFFWKFFK.',
  '.KFFFFFFFFFFFFK.',
  '.KFFFMMMMMMFFFK.',
  '..KFMMMKKMMMFK..',
  '..KFMMMKKMMMFK..',
  '...KMMTTTTMMK...',
  '...KFMMMMMMFK...',
  '..KCCCCCCCCCCK..',
  '..KCCBKKBCCK....',
  '...KKK..KKK.....',
];

function paintDog(el, map, px) {
  const w = Math.max(...map.map((r) => r.length));
  const h = map.length;
  let rects = '';
  map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = DOG_COLORS[row[x]];
      if (c) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"/>`;
    }
  });
  el.innerHTML =
    `<svg class="${el.dataset.cls || ''}" width="${w * px}" height="${h * px}" viewBox="0 0 ${w} ${h}" ` +
    `shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Watchdog, the AgentAuth guard dog">${rects}</svg>`;
}

document.querySelectorAll('[data-dog]').forEach((el) => paintDog(el, DOG, Number(el.dataset.dog) || 10));

/* =========================================================================
 * scope.ts port — exact match + `prefix:*` wildcard + `*`.
 * ========================================================================= */
function scopeSatisfied(granted, required) {
  for (const g of granted) {
    if (g === required || g === '*') return true;
    if (g.endsWith(':*') && required.startsWith(g.slice(0, -1))) return true;
  }
  return false;
}
function missingScopes(granted, required) {
  return required.filter((r) => !scopeSatisfied(granted, r));
}

/* =========================================================================
 * errors.ts port — typed errors, each carrying a `.code`.
 * ========================================================================= */
class AgentAuthError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = 'AgentAuthError';
  }
}
class InvalidGrantError extends AgentAuthError {
  constructor(message) { super(message, 'invalid_grant'); this.name = 'InvalidGrantError'; }
}
class TokenInvalidError extends AgentAuthError {
  constructor(message = 'token is invalid') { super(message, 'token_invalid'); this.name = 'TokenInvalidError'; }
}
class TokenExpiredError extends AgentAuthError {
  constructor(message = 'token has expired') { super(message, 'token_expired'); this.name = 'TokenExpiredError'; }
}
class RevokedError extends AgentAuthError {
  constructor(message = 'token has been revoked') { super(message, 'token_revoked'); this.name = 'RevokedError'; }
}
class MissingScopeError extends AgentAuthError {
  constructor(missing) { super('insufficient scope', 'missing_scope'); this.missing = missing; this.name = 'MissingScopeError'; }
}

/* =========================================================================
 * Minimal in-memory revocation store (port of MemoryStore semantics).
 * Tracks revoked jtis, agents, and subjects.
 * ========================================================================= */
class MemoryStore {
  constructor() {
    this.jtis = new Set();
    this.agents = new Set();
    this.subjects = new Set();
  }
  revoke(criteria) {
    if (criteria.jti) this.jtis.add(criteria.jti);
    if (criteria.agent) this.agents.add(criteria.agent);
    if (criteria.subject) this.subjects.add(criteria.subject);
  }
  isRevoked({ jti, agent, subject }) {
    return (
      (jti && this.jtis.has(jti)) ||
      (agent && this.agents.has(agent)) ||
      (subject && this.subjects.has(subject))
    );
  }
}

/* =========================================================================
 * agentauth.ts port — issue / verify / revoke faithful to the source.
 * ========================================================================= */
const DEFAULT_TTL_SECONDS = 15 * 60;
const DEFAULT_CLOCK_TOLERANCE = 30;

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}
function toClaims(p) {
  return {
    sub: String(p.sub),
    agent: String(p.agent),
    scopes: isStringArray(p.scopes) ? p.scopes : [],
    jti: String(p.jti),
    iss: String(p.iss),
    aud: Array.isArray(p.aud) ? (p.aud[0] ?? '') : String(p.aud ?? ''),
    iat: Number(p.iat),
    exp: Number(p.exp),
  };
}

class AgentAuth {
  constructor(config) {
    this.key =
      typeof config.secret === 'string' ? new TextEncoder().encode(config.secret) : config.secret;
    this.issuer = config.issuer ?? 'agentauth';
    this.audience = config.audience ?? 'agentauth';
    this.ttl = config.defaultTtlSeconds ?? DEFAULT_TTL_SECONDS;
    this.clockTolerance = config.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE;
    this.checkRevocationDefault = config.checkRevocation ?? true;
    this.store = config.store ?? new MemoryStore();
    this.onEvent = config.onEvent;
  }

  async issue(grant) {
    if (!grant.subject) throw new InvalidGrantError('subject is required');
    if (!grant.agent) throw new InvalidGrantError('agent is required');
    if (!grant.scopes?.length) throw new InvalidGrantError('at least one scope is required');
    if (grant.scopes.some((s) => typeof s !== 'string' || s.trim() === '')) {
      throw new InvalidGrantError('scopes must be non-empty strings');
    }

    const jti = crypto.randomUUID();
    const iat = Math.floor(Date.now() / 1000);
    const ttlSeconds = grant.ttlSeconds ?? this.ttl;
    const exp = iat + ttlSeconds;

    const token = await new SignJWT({ agent: grant.agent, scopes: grant.scopes })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(grant.subject)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setJti(jti)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(this.key);

    this.emit({ type: 'issued', jti, subject: grant.subject, agent: grant.agent, scopes: grant.scopes, expiresAt: exp });
    return { token, jti, expiresAt: exp };
  }

  async verify(token, opts = {}) {
    let claims;
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.issuer,
        audience: this.audience,
        clockTolerance: this.clockTolerance,
        algorithms: ['HS256'],
      });
      claims = toClaims(payload);
    } catch (err) {
      const wrapped =
        err instanceof joseErrors.JWTExpired ? new TokenExpiredError() : new TokenInvalidError();
      this.emit({ type: 'denied', reason: wrapped.code });
      throw wrapped;
    }

    const shouldCheck = opts.checkRevocation ?? this.checkRevocationDefault;
    const revSubject = { jti: claims.jti, agent: claims.agent, subject: claims.sub };
    if (shouldCheck && this.store.isRevoked(revSubject)) {
      this.emit({ type: 'denied', reason: 'token_revoked', jti: claims.jti });
      throw new RevokedError();
    }

    const missing = missingScopes(claims.scopes, opts.requiredScopes ?? []);
    if (missing.length) {
      this.emit({ type: 'denied', reason: 'missing_scope', jti: claims.jti });
      throw new MissingScopeError(missing);
    }

    this.emit({ type: 'verified', jti: claims.jti, subject: claims.sub, agent: claims.agent, scopes: claims.scopes });
    return claims;
  }

  async revoke(target) {
    if (typeof target === 'object') {
      this.store.revoke(target);
      this.emit({ type: 'revoked', agent: target.agent, subject: target.subject, jti: target.jti });
      return;
    }
    let jti = target;
    try {
      const { payload } = await jwtVerify(target, this.key, {
        issuer: this.issuer,
        audience: this.audience,
        clockTolerance: this.clockTolerance,
        algorithms: ['HS256'],
      });
      jti = String(payload.jti);
    } catch {
      // Not a valid token — treat input as a bare jti.
    }
    this.store.revoke({ jti });
    this.emit({ type: 'revoked', jti });
  }

  emit(event) {
    if (!this.onEvent) return;
    try { this.onEvent(event); } catch { /* audit must never break auth */ }
  }
}

/* =========================================================================
 * Demo wiring
 * ========================================================================= */

// Fixed demo secret generated client-side (48 random bytes, well over the 32-byte HS256 floor).
const secretBytes = crypto.getRandomValues(new Uint8Array(48));

const $ = (id) => document.getElementById(id);
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const dogEl = $('dog');
const bubbleEl = $('dog-bubble');
const roleEl = $('dog-role');
const logEl = $('event-log');
const resultEl = $('result');

let currentToken = null;
let currentClaims = null;

const auth = new AgentAuth({
  secret: secretBytes,
  issuer: 'agentauth',
  audience: 'agentauth',
  onEvent: (e) => logEvent(e),
});

/* ---------- helpers ---------- */
function getChecked(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((el) => el.value);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function logEvent(e) {
  const ts = new Date().toLocaleTimeString([], { hour12: false });
  const cls = {
    issued: 'log-issued',
    verified: 'log-verified',
    denied: 'log-denied',
    revoked: 'log-revoked',
  }[e.type] || '';
  const detail = Object.entries(e)
    .filter(([k]) => k !== 'type')
    .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.join(' ')}]` : v}`)
    .join(' ');
  const line = document.createElement('span');
  line.className = `log-line ${cls}`;
  line.innerHTML = `<span class="ts">${ts}</span> ${e.type.toUpperCase().padEnd(8)} ${escapeHtml(detail)}`;
  // newest first
  if (logEl.firstChild && logEl.firstChild.nodeType === Node.ELEMENT_NODE) {
    logEl.insertBefore(line, logEl.firstChild);
  } else {
    logEl.innerHTML = '';
    logEl.appendChild(line);
  }
}

function dogReact(mood) {
  // mood: 'happy' | 'allow' | 'deny'
  roleEl.classList.remove('allow', 'deny');
  bubbleEl.classList.remove('bark');
  dogEl.classList.remove('shake');

  if (mood === 'deny') {
    bubbleEl.textContent = 'BARK! denied.';
    bubbleEl.classList.add('bark');
    roleEl.textContent = 'intruder turned away · no entry';
    roleEl.classList.add('deny');
    if (!prefersReduced) {
      // restart shake animation
      void dogEl.offsetWidth;
      dogEl.classList.add('shake');
    }
  } else if (mood === 'allow') {
    bubbleEl.textContent = 'good badge. come in.';
    roleEl.textContent = 'scopes check out · access granted';
    roleEl.classList.add('allow');
  } else {
    bubbleEl.textContent = 'fresh badge minted. *wag*';
    roleEl.textContent = 'guards the gate · checks every token';
  }
}

function setResult(state, badge, msgHtml) {
  resultEl.className = `result result-${state}`;
  resultEl.innerHTML = `<span class="result-badge">${badge}</span><span class="result-msg">${msgHtml}</span>`;
}

/* ---------- ISSUE ---------- */
$('btn-issue').addEventListener('click', async () => {
  const scopes = getChecked('grant-scope');
  const subject = $('grant-subject').value.trim();
  const agent = $('grant-agent').value.trim();
  const ttlSeconds = Number($('grant-ttl').value) || DEFAULT_TTL_SECONDS;

  try {
    const { token } = await auth.issue({ subject, agent, scopes, ttlSeconds });
    currentToken = token;
    currentClaims = decodeJwt(token);
    $('jwt-out').textContent = token;
    $('claims-out').textContent = JSON.stringify(currentClaims, null, 2);
    dogReact('happy');
    setResult('idle', 'READY', `Token minted for <b>${escapeHtml(agent)}</b>. Now verify it.`);
  } catch (err) {
    currentToken = null;
    setResult('deny', 'ERROR', `<b>${err.name}</b> <span class="errcode">${err.code}</span> — ${escapeHtml(err.message)}`);
    dogReact('deny');
  }
});

/* ---------- VERIFY ---------- */
$('btn-verify').addEventListener('click', async () => {
  if (!currentToken) {
    setResult('deny', 'DENY', 'No token yet — issue one first.');
    dogReact('deny');
    return;
  }
  const requiredScopes = getChecked('req-scope');
  const checkRevocation = $('check-revocation').checked;

  try {
    const claims = await auth.verify(currentToken, { requiredScopes, checkRevocation });
    const reqLabel = requiredScopes.length ? requiredScopes.map((s) => `<code>${escapeHtml(s)}</code>`).join(' ') : '<i>none</i>';
    setResult('allow', 'ALLOW', `Required ${reqLabel} satisfied by [${claims.scopes.map(escapeHtml).join(', ')}].`);
    dogReact('allow');
  } catch (err) {
    const extra = err.code === 'missing_scope' && err.missing ? ` (missing: ${err.missing.join(', ')})` : '';
    setResult('deny', 'DENY', `<b>${err.name}</b> <span class="errcode">${err.code}</span>${escapeHtml(extra)}`);
    dogReact('deny');
  }
});

/* ---------- REVOKE ---------- */
$('btn-revoke-token').addEventListener('click', async () => {
  if (!currentToken) { flashRevokeHint(); return; }
  await auth.revoke(currentToken);
  setResult('idle', 'REVOKED', 'This token\'s <code>jti</code> is revoked. Verify with revocation on to see it denied.');
});
$('btn-revoke-agent').addEventListener('click', async () => {
  if (!currentClaims) { flashRevokeHint(); return; }
  await auth.revoke({ agent: currentClaims.agent });
  setResult('idle', 'REVOKED', `All tokens for agent <b>${escapeHtml(currentClaims.agent)}</b> are revoked.`);
});
$('btn-revoke-subject').addEventListener('click', async () => {
  if (!currentClaims) { flashRevokeHint(); return; }
  await auth.revoke({ subject: currentClaims.sub });
  setResult('idle', 'REVOKED', `All tokens for subject <b>${escapeHtml(currentClaims.sub)}</b> are revoked.`);
});

function flashRevokeHint() {
  setResult('deny', 'DENY', 'No token to revoke — issue one first.');
  dogReact('deny');
}

/* ---------- copy + clear ---------- */
$('copy-jwt').addEventListener('click', async () => {
  if (!currentToken) return;
  await navigator.clipboard.writeText(currentToken);
  const b = $('copy-jwt');
  b.textContent = 'copied ✓'; b.classList.add('copied');
  setTimeout(() => { b.textContent = 'copy'; b.classList.remove('copied'); }, 1300);
});
$('clear-log').addEventListener('click', () => {
  logEl.innerHTML = '<span class="tok-com">// cleared</span>';
});
