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

const CLASS_FIELDS = ['class_date', 'start_time', 'end_time', 'place', 'capacity', 'is_public', 'status'];
const CLASS_STATUSES = new Set(['open', 'waitlist', 'closed', 'hidden']);

function pickClassFields(input: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const key of CLASS_FIELDS) {
    if (input[key] === undefined || input[key] === null || input[key] === '') continue;
    if (key === 'capacity') row[key] = Number(input[key]);
    else if (key === 'is_public') row[key] = Boolean(input[key]);
    else row[key] = input[key];
  }
  if (row.status !== undefined && !CLASS_STATUSES.has(String(row.status))) throw new Error('invalid class status');
  return row;
}

async function listAdminData() {
  // Admin uses the service role, so it reads the raw public.classes / public.reservations tables
  // directly (the anon-facing public.class_reservation_summary view hides non-public / hidden classes,
  // which the admin still needs to manage). Counts are computed here from the same data.
  const classes = await supabaseFetch('classes?select=*&order=class_date.asc,start_time.asc');
  const reservations = await supabaseFetch('reservations?select=*&order=created_at.asc');
  const classRows = Array.isArray(classes) ? classes : [];
  const reservationRows = Array.isArray(reservations) ? reservations : [];

  const summary = classRows.map((c: Record<string, unknown>) => {
    const rows = reservationRows.filter((r: Record<string, unknown>) => r.class_id === c.id);
    const confirmed = rows.filter((r) => r.reservation_status === 'confirmed' || r.payment_status === 'paid').length;
    const waitlist = rows.filter((r) => r.reservation_status === 'applied' || r.reservation_status === 'waitlisted').length;
    const paymentReady = rows.filter((r) => r.reservation_status === 'payment_target').length;
    return {
      class_id: c.id,
      class_date: c.class_date,
      start_time: c.start_time,
      end_time: c.end_time,
      place: c.place,
      capacity: c.capacity,
      is_public: c.is_public,
      status: c.status,
      confirmed_count: confirmed,
      available_count: Math.max(Number(c.capacity || 0) - confirmed, 0),
      waitlist_count: waitlist,
      payment_ready_count: paymentReady,
    };
  });
  return { ok: true, classes: summary, reservations: reservationRows };
}

async function createClass(input: Record<string, unknown>) {
  const row = pickClassFields(input || {});
  if (!row.class_date || !row.start_time || !row.end_time) {
    throw new Error('class_date, start_time, end_time are required');
  }
  const created = await supabaseFetch('classes', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  return { ok: true, class: Array.isArray(created) ? created[0] : created };
}

async function updateClass(classId: string, updates: Record<string, unknown>) {
  if (!classId) throw new Error('classId is required');
  const row = pickClassFields(updates || {});
  row.updated_at = new Date().toISOString();
  const updated = await supabaseFetch(`classes?id=eq.${encodeURIComponent(classId)}&select=*`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  return { ok: true, class: Array.isArray(updated) ? updated[0] : updated };
}

async function deleteClass(classId: string) {
  if (!classId) throw new Error('classId is required');
  // public.reservations rows for this class are removed via ON DELETE CASCADE.
  await supabaseFetch(`classes?id=eq.${encodeURIComponent(classId)}`, { method: 'DELETE' });
  return { ok: true };
}

async function bulkApprove(classId: string) {
  if (!classId) throw new Error('classId is required');
  // 선착순(신청 시간순)으로, 예약 가능 인원(capacity)에서 이미 확정된 인원을 뺀 만큼을
  // '결제 안내 대상(payment_target)'으로 지정하고, 초과분은 자동으로 '대기(waitlisted)'로 저장한다.
  const classRows = await supabaseFetch(`classes?id=eq.${encodeURIComponent(classId)}&select=capacity`);
  const capacity = Array.isArray(classRows) && classRows[0] ? Number(classRows[0].capacity || 0) : 0;
  const reservations = await supabaseFetch(`reservations?class_id=eq.${encodeURIComponent(classId)}&select=*&order=created_at.asc`);
  const rows = Array.isArray(reservations) ? reservations : [];

  const confirmedCount = rows.filter((r) => r.reservation_status === 'confirmed' || r.payment_status === 'paid').length;
  const remaining = Math.max(capacity - confirmedCount, 0);
  const candidates = rows.filter((r) =>
    r.reservation_status !== 'confirmed' && r.payment_status !== 'paid'
    && r.reservation_status !== 'cancelled' && r.reservation_status !== 'no_show'
  );

  let approved = 0;
  let waitlisted = 0;
  for (let i = 0; i < candidates.length; i += 1) {
    const reservation = candidates[i];
    const updates = i < remaining
      ? { reservation_status: 'payment_target', payment_status: 'sent', waitlist_order: null }
      : { reservation_status: 'waitlisted', waitlist_order: (i - remaining) + 1 };
    if (i < remaining) approved += 1; else waitlisted += 1;
    await supabaseFetch(`reservations?id=eq.${encodeURIComponent(reservation.id)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }),
    });
  }
  return { ok: true, capacity, remaining, approved, waitlisted };
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
    if (action === 'createClass') return jsonResponse(await createClass(body.class || {}));
    if (action === 'updateClass') return jsonResponse(await updateClass(String(body.classId || ''), body.updates || {}));
    if (action === 'deleteClass') return jsonResponse(await deleteClass(String(body.classId || '')));
    if (action === 'bulkApprove') return jsonResponse(await bulkApprove(String(body.classId || '')));
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
