// ---------------------------------------------------------------- Cloudflare Access (email-code sign-in) check
let _certs = null, _certsAt = 0;
export async function accessUser(req, env) {
  if (env.DEV_NOAUTH === '1') return 'dev@localhost';
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD) return null;
  const tok = req.headers.get('cf-access-jwt-assertion') || (req.headers.get('cookie') || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
  if (!tok) return null;
  const [h64, p64, s64] = tok.split('.');
  if (!s64) return null;
  const dec = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
  const head = JSON.parse(new TextDecoder().decode(dec(h64)));
  const body = JSON.parse(new TextDecoder().decode(dec(p64)));
  if (!_certs || Date.now() - _certsAt > 3600e3) {
    _certs = (await (await fetch(`https://${env.ACCESS_TEAM}/cdn-cgi/access/certs`)).json()).keys;
    _certsAt = Date.now();
  }
  const jwk = _certs.find(k => k.kid === head.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, dec(s64), new TextEncoder().encode(`${h64}.${p64}`));
  const aud = Array.isArray(body.aud) ? body.aud : [body.aud];
  if (!ok || !aud.includes(env.ACCESS_AUD) || body.exp * 1000 < Date.now() || body.iss !== `https://${env.ACCESS_TEAM}`) return null;
  return body.email || 'service';
}

