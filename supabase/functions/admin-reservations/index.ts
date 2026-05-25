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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

async function assertAdminPassword(password: string): Promise<void> {
  const ADMIN_PASSWORD_HASH = Deno.env.get('ADMIN_PASSWORD_HASH');
  if (!ADMIN_PASSWORD_HASH) throw new Error('ADMIN_PASSWORD_HASH is not configured');
  const candidateHash = await sha256Hex(password);
  if (!timingSafeEqual(candidateHash, ADMIN_PASSWORD_HASH)) throw new Error('invalid password');
}

function getSupabaseAdmin() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) throw new Error('Supabase admin secrets are not configured');
  return { url: url.replace(/\/$/, ''), serviceKey };
}

async function supabaseFetch(path: string, options: RequestInit = {}) {
  const { url, serviceKey } = getSupabaseAdmin();
  const headers = new Headers(options.headers || {});
  headers.set('apikey', serviceKey);
  headers.set('authorization', `Bearer ${serviceKey}`);
  if (!headers.has('content-type') && options.body) headers.set('content-type', 'application/json');

  const response = await fetch(`${url}/rest/v1/${path}`, { ...options, headers });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Supabase request failed: ${response.status}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function listAdminData() {
  // Reads public.class_reservation_summary and public.reservations through PostgREST's public schema.
  const classes = await supabaseFetch('class_reservation_summary?select=*&order=class_date.asc,start_time.asc');
  const reservations = await supabaseFetch('reservations?select=*&order=created_at.asc');
  return { ok: true, classes, reservations };
}

async function updateReservation(reservationId: string, updates: Record<string, unknown>) {
  const allowedKeys = new Set(['reservation_status', 'payment_status', 'waitlist_order', 'admin_memo']);
  const safeUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(updates || {})) {
    if (allowedKeys.has(key)) safeUpdates[key] = value;
  }
  if (!reservationId) throw new Error('reservationId is required');

  const reservation = await supabaseFetch(`reservations?id=eq.${encodeURIComponent(reservationId)}&select=*`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(safeUpdates),
  });
  return { ok: true, reservation: Array.isArray(reservation) ? reservation[0] : reservation };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    const password = String(body.password || '');
    await assertAdminPassword(password);

    if (action === 'list') return jsonResponse(await listAdminData());
    if (action === 'updateReservation') {
      return jsonResponse(await updateReservation(String(body.reservationId || ''), body.updates || {}));
    }

    return jsonResponse({ error: 'unknown action' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    const status = message === 'invalid password' ? 401 : 500;
    return jsonResponse({ ok: false, error: message }, status);
  }
});
