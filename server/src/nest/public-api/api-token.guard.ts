import { getClientIp } from '../audit/client-ip';
import { RateLimitService } from '../common/rate-limit.service';
import { TokenService } from '../tokens/token.service';
import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';

import type { Request } from 'express';

const API_TOKEN_AUTH_RATE_WINDOW_MS = 60_000;
const API_TOKEN_AUTH_RATE_MAX_PER_MINUTE = 120;

/**
 * Authenticates a caller of the public API with a long-lived `trek_…` token.
 *
 * Accepts an **API key** — the kind users mint under Settings → Integrations for
 * third-party software. An MCP token does not resolve here, and an API key does not
 * open the MCP surface: the two are separate credentials with separate blast radii,
 * and `verifyApiToken` puts the kind in the WHERE clause so a token of the wrong
 * kind is indistinguishable from one that does not exist.
 *
 * The lookup hashes the presented key with SHA-256 and matches the hash — the raw
 * key is never stored and never compared in the application, so a database read
 * cannot yield a usable credential.
 *
 * Deliberately narrower than the MCP transport's `verifyToken`, which also accepts
 * OAuth bearer tokens and a plain web-session JWT:
 *
 * - **No session JWT.** A session cookie leaking into a third-party integration is
 *   exactly what a machine credential exists to prevent, and a JWT that reaches
 *   this surface is almost always an accident.
 * - **No OAuth tokens (yet).** They carry scopes this surface does not interpret
 *   yet, and accepting a credential whose restrictions you ignore is worse than
 *   refusing it. When `/api/v1` grows write routes, scopes get honoured first.
 *
 * The guard authenticates but does not authorise: it resolves `req.user` and stops
 * there. Which trips that user may read is decided per row against
 * `DatabaseService.canAccessTrip`, never from anything the caller sent.
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly rl: RateLimitService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const token = extractApiToken(req);
    if (!token) {
      throw new HttpException({ error: 'API token required', code: 'API_TOKEN_REQUIRED' }, 401);
    }

    // The controller's user-keyed limiter cannot protect this path because an
    // invalid token never produces a user. Bound token guesses by the trusted
    // request IP before hitting the token store; valid callers still receive the
    // controller's higher per-user budget after authentication.
    const ip = getClientIp(req) ?? 'unknown';
    if (
      !this.rl.check(
        'public-api-auth',
        ip,
        API_TOKEN_AUTH_RATE_MAX_PER_MINUTE,
        API_TOKEN_AUTH_RATE_WINDOW_MS,
        Date.now(),
      )
    ) {
      throw new HttpException({ error: 'Too many authentication attempts', code: 'API_TOKEN_RATE_LIMITED' }, 429);
    }

    const user = this.tokens.verifyApiToken(token);
    if (!user) {
      throw new HttpException({ error: 'Invalid API token', code: 'API_TOKEN_INVALID' }, 401);
    }
    req.user = user;
    return true;
  }
}

/**
 * `Authorization: Bearer trek_…` or `X-API-Key: trek_…`.
 *
 * Both spellings exist because integrators expect one or the other and neither is
 * wrong; the header is the only difference. Anything that is not a `trek_` token is
 * rejected here rather than passed to the lookup — a session JWT would otherwise
 * travel one step further into the system than it should, and the hash of an
 * arbitrary string is a pointless query.
 */
function extractApiToken(req: Request): string | null {
  const header = req.headers['authorization'];
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const candidate = header.slice(7).trim();
    if (candidate.startsWith('trek_')) return candidate;
  }
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim().startsWith('trek_')) {
    return apiKey.trim();
  }
  return null;
}
