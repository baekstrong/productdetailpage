import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const ADMIN_PASSWORD_HASH = Deno.env.get('ADMIN_PASSWORD_HASH');
  if (!ADMIN_PASSWORD_HASH) {
    return new Response(JSON.stringify({ error: 'ADMIN_PASSWORD_HASH is not configured' }), { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' } });
  }

  const body = await req.json().catch(() => ({}));
  const password = String(body.password || '');
  const candidateHash = await sha256Hex(password);
  const ok = timingSafeEqual(candidateHash, ADMIN_PASSWORD_HASH);

  if (!ok) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid password' }), { status: 401, headers: { ...corsHeaders, 'content-type': 'application/json' } });
  }

  const expiresAt = Date.now() + 1000 * 60 * 60;
  const tokenPayload = JSON.stringify({ role: 'admin', expiresAt });
  const token = btoa(tokenPayload);

  return new Response(JSON.stringify({ ok: true, token, expiresAt }), { status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' } });
});
