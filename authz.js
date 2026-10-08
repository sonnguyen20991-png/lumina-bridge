import crypto from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRITE_ROLES = new Set(['owner', 'admin', 'manager', 'member']);
const READ_ONLY_POST_PATHS = new Set([
  '/api/v1/search/interpret',
  '/api/v1/search/people'
]);

let iapKeyCache = { expiresAt: 0, keys: new Map() };

function jsonError(res, status, code, extra = {}) {
  return res.status(status).json({ status: 'error', code, ...extra });
}

function b64urlJson(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

async function getIapKeys() {
  if (Date.now() < iapKeyCache.expiresAt && iapKeyCache.keys.size) return iapKeyCache.keys;
  const response = await fetch('https://www.gstatic.com/iap/verify/public_key-jwk');
  if (!response.ok) throw new Error(`IAP_KEY_FETCH_FAILED:${response.status}`);
  const jwks = await response.json();
  const keys = new Map();
  for (const jwk of jwks.keys || []) {
    if (jwk.kid) keys.set(jwk.kid, jwk);
  }
  iapKeyCache = { expiresAt: Date.now() + 6 * 60 * 60 * 1000, keys };
  return keys;
}

async function verifyIapJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('IAP_JWT_MALFORMED');
  const [h, p, sig] = parts;
  const header = b64urlJson(h);
  const payload = b64urlJson(p);
  if (header.alg !== 'ES256') throw new Error('IAP_JWT_ALG_UNSUPPORTED');
  const keys = await getIapKeys();
  const jwk = keys.get(header.kid);
  if (!jwk) throw new Error('IAP_JWT_KEY_NOT_FOUND');
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify(
    'sha256',
    Buffer.from(`${h}.${p}`),
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(sig, 'base64url')
  );
  if (!ok) throw new Error('IAP_JWT_SIGNATURE_INVALID');

  const now = Math.floor(Date.now() / 1000);
  const audience = process.env.LUMINA_IAP_AUDIENCE;
  if (!audience) throw new Error('IAP_AUDIENCE_NOT_CONFIGURED');
  if (payload.iss !== 'https://cloud.google.com/iap') throw new Error('IAP_JWT_ISSUER_INVALID');
  if (payload.aud !== audience) throw new Error('IAP_JWT_AUDIENCE_INVALID');
  if (!Number.isInteger(payload.exp) || !Number.isInteger(payload.iat)) {
    throw new Error('IAP_JWT_TIME_CLAIMS_INVALID');
  }

  if (payload.exp < now - 30) {
    throw new Error('IAP_JWT_EXPIRED');
  }

  if (payload.iat > now + 30) {
    throw new Error('IAP_JWT_IAT_INVALID');
  }

  if (payload.exp - payload.iat > 660) {
    throw new Error('IAP_JWT_LIFETIME_INVALID');
  }

  if (payload.iat < now - 660) {
    throw new Error('IAP_JWT_TOO_OLD');
  }

  if (!payload.sub) {
    throw new Error('IAP_JWT_SUBJECT_MISSING');
  }

  if (!payload.email) {
    throw new Error('IAP_JWT_EMAIL_MISSING');
  }

  return {
    provider: 'iap',
    subject: String(payload.sub),
    email: String(payload.email).toLowerCase()
  };
}

async function identityFromRequest(req) {
  const mode = process.env.LUMINA_AUTH_MODE || 'staging-header';
  if (mode === 'staging-header') {
    const subject = String(req.get('X-Lumina-Test-Principal') || '').trim().toLowerCase();
    if (!subject) return null;
    return { provider: 'staging-header', subject, email: subject.includes('@') ? subject : null };
  }
  if (mode === 'iap') {
    const token = req.get('X-Goog-IAP-JWT-Assertion');
    if (!token) return null;
    return await verifyIapJwt(token);
  }
  throw new Error('AUTH_MODE_INVALID');
}

function isWriteRequest(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return false;

  // Authorization middleware is mounted at /api/v1.
  // req.path may therefore be relative to the mount point.
  // originalUrl preserves the complete API route.
  const requestPath = String(
    req.originalUrl || req.url || req.path || ''
  ).split('?')[0];

  if (
    req.method === 'POST' &&
    READ_ONLY_POST_PATHS.has(requestPath)
  ) {
    return false;
  }

  return true;
}

export function registerAuthorization(app, pool) {
  app.use('/api/v1', async (req, res, next) => {
    try {
      const identity = await identityFromRequest(req);
      if (!identity) return jsonError(res, 401, 'AUTHENTICATION_REQUIRED');

      const result = await pool.query(
        `
          SELECT
            p.id AS principal_id,
            p.provider,
            p.subject,
            p.email,
            cm.client_id,
            cm.role,
            c.name AS client_name
          FROM app_principals p
          JOIN client_memberships cm
            ON cm.principal_id = p.id
           AND cm.status = 'active'
          JOIN clients c
            ON c.id = cm.client_id
           AND c.status = 'active'
          WHERE p.status = 'active'
            AND p.provider = $1
            AND p.subject = $2
          ORDER BY cm.created_at, cm.client_id
        `,
        [identity.provider, identity.subject]
      );

      if (result.rowCount === 0) {
        const bootstrapEmail = String(
          process.env.LUMINA_IAP_BOOTSTRAP_EMAIL || ''
        ).trim().toLowerCase();

        if (
          identity.provider === 'iap' &&
          bootstrapEmail &&
          identity.email === bootstrapEmail
        ) {
          return jsonError(
            res,
            409,
            'IAP_BOOTSTRAP_REQUIRED',
            {
              bootstrap_subject: identity.subject,
              bootstrap_email: identity.email
            }
          );
        }

        return jsonError(
          res,
          403,
          'NO_ACTIVE_CLIENT_MEMBERSHIP'
        );
      }

      const requestedClientId = String(req.get('X-Lumina-Client-Id') || '').trim();
      let membership = null;

      if (requestedClientId) {
        if (!UUID_RE.test(requestedClientId)) return jsonError(res, 400, 'INVALID_CLIENT_CONTEXT');
        membership = result.rows.find(row => row.client_id === requestedClientId) || null;
        if (!membership) return jsonError(res, 403, 'CLIENT_ACCESS_DENIED');
      } else if (result.rowCount === 1) {
        membership = result.rows[0];
      } else {
        return jsonError(res, 409, 'CLIENT_CONTEXT_REQUIRED', {
          available_clients: result.rows.map(row => ({ id: row.client_id, name: row.client_name, role: row.role }))
        });
      }

      req.auth = {
        principalId: membership.principal_id,
        provider: membership.provider,
        subject: membership.subject,
        email: membership.email,
        clientId: membership.client_id,
        clientName: membership.client_name,
        role: membership.role
      };

      const suppliedBodyClient = typeof req.body?.client_id === 'string' ? req.body.client_id.trim() : '';
      if (suppliedBodyClient && suppliedBodyClient !== req.auth.clientId) {
        return jsonError(res, 403, 'CLIENT_SCOPE_MISMATCH');
      }

      if (isWriteRequest(req) && !WRITE_ROLES.has(req.auth.role)) {
        return jsonError(res, 403, 'INSUFFICIENT_ROLE', { required: 'write', role: req.auth.role });
      }

      const jobMatch = req.path.match(/^\/import-jobs\/([0-9a-f-]{36})(?:\/retry)?$/i);
      if (jobMatch) {
        const job = await pool.query(
          `SELECT id FROM import_jobs WHERE id = $1 AND client_id = $2 LIMIT 1`,
          [jobMatch[1], req.auth.clientId]
        );
        if (job.rowCount !== 1) return jsonError(res, 404, 'IMPORT_JOB_NOT_FOUND');
      }

      res.set('Cache-Control', 'no-store');
      next();
    } catch (error) {
      console.error('Authorization failed:', error);
      return jsonError(res, 401, 'AUTHENTICATION_FAILED');
    }
  });
}
