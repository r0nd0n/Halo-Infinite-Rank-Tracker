import { config } from '../config.js';

/**
 * Xbox / Microsoft OAuth helpers for obtaining a refresh token which can then
 * be exchanged for Halo "Spartan" and "clearance" tokens. Only needed for the
 * official provider's automatic token refresh.
 *
 * These mirror the documented SPNKr flow. The interactive login helper
 * (src/auth/login.js) walks through them once to produce HALO_REFRESH_TOKEN.
 */

export const XBOX_SCOPE = 'Xboxlive.signin Xboxlive.offline_access';

export function buildAuthorizeUrl({ clientId, redirectUri }) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: XBOX_SCOPE,
    response_mode: 'query',
  });
  return `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${params.toString()}`;
}

async function postForm(url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    throw new Error(`OAuth request failed (${resp.status}): ${text.slice(0, 300)}`);
  }
  return data;
}

/** Exchange an authorization code for tokens (one-time login step). */
export async function exchangeCodeForTokens(code) {
  return postForm('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
    scope: XBOX_SCOPE,
  });
}

/** Use a refresh token to get a fresh Microsoft access/refresh token pair. */
export async function refreshMicrosoftToken() {
  const body = {
    client_id: config.clientId,
    grant_type: 'refresh_token',
    refresh_token: config.refreshToken,
    scope: XBOX_SCOPE,
  };
  if (config.clientSecret) body.client_secret = config.clientSecret;
  return postForm('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', body);
}

/** Exchange a Microsoft access token for an Xbox Live user token. */
export async function getUserToken(msaAccessToken) {
  const resp = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' },
    body: JSON.stringify({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${msaAccessToken}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }),
  });
  if (!resp.ok) throw new Error(`Xbox user auth failed (${resp.status})`);
  return resp.json();
}

/** Exchange the Xbox user token for an XSTS token for a given relying party. */
export async function getXstsToken(userToken, relyingParty) {
  const resp = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' },
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [userToken.Token] },
      RelyingParty: relyingParty,
      TokenType: 'JWT',
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`XSTS auth failed (${resp.status}): ${body.slice(0, 200)}`);
  }
  return resp.json();
}

/** Xbox Live authentication -> { xuid, userHash, xstsToken } for Halo. */
export async function getXboxTokens() {
  const ms = await refreshMicrosoftToken();
  const user = await getUserToken(ms.access_token);
  const xsts = await getXstsToken(user, 'http://xboxlive.com');
  const claims = xsts.DisplayClaims.xui[0];
  return {
    xuid: String(claims.xid),
    userHash: claims.uhs,
    xstsToken: xsts.Token,
    refreshToken: ms.refresh_token || config.refreshToken,
  };
}
