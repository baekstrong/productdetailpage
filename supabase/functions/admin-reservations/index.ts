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

// --- 자동 문자 발송 (solapi-reservations 함수를 서버사이드로 호출) ---
const PAYMENT_LINK = Deno.env.get('PAYMENT_LINK') || 'https://smartstore.naver.com/easystrength101/products/9825334073';

function maskPhone(phone: string): string {
  return String(phone || '').replace(/^(010)(\d{4})(\d{4})$/, '$1-****-$3');
}

async function sendSms(password: string, messageType: string, phone: string, values: Record<string, string>, scheduledAt?: string) {
  const { url, serviceKey } = getSupabaseAdmin();
  try {
    const response = await fetch(`${url}/functions/v1/solapi-reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ password, messageType, phone, values, scheduledAt }),
    });
    return await response.json().catch(() => ({ ok: false, error: 'invalid solapi response' }));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'solapi call failed' };
  }
}

async function logMessage(reservationId: string, messageType: string, phone: string, result: Record<string, unknown>, scheduledAt?: string) {
  try {
    const ok = Boolean(result && result.ok);
    const status = ok ? (scheduledAt ? 'scheduled' : 'sent') : (result && result.skipped ? 'skipped' : 'failed');
    await supabaseFetch('message_logs', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        reservation_id: reservationId,
        message_type: messageType,
        phone_masked: maskPhone(phone),
        provider_message_id: (result && ((result.groupId as string) || (result.messageId as string))) || null,
        status,
        error_message: ok ? null : ((result && (result.error || result.reason)) as string) || null,
        scheduled_at: scheduledAt || null,
        sent_at: new Date().toISOString(),
      }),
    });
  } catch (_) {
    // 로깅 실패는 무시(베스트 에포트)
  }
}

async function notify(password: string, reservation: Record<string, unknown>, messageType: string, values: Record<string, string>, scheduledAt?: string) {
  const phone = String(reservation?.phone || '');
  if (!phone) return;
  const result = await sendSms(password, messageType, phone, values, scheduledAt);
  await logMessage(String(reservation.id), messageType, phone, result as Record<string, unknown>, scheduledAt);
}

// 예약 발송 시각 계산(KST). scheduledDate는 Solapi에 보낼 "YYYY-MM-DD HH:mm:ss"(KST 로컬),
// atMs는 과거 여부 비교용 절대시각(ms). Edge 런타임은 UTC이므로 KST는 직접 계산한다.
function kstReminderSchedule(classDate: string): { scheduledDate: string; atMs: number } | null {
  const base = new Date(`${classDate}T00:00:00Z`);
  if (isNaN(base.getTime())) return null;
  const prev = new Date(base.getTime() - 24 * 60 * 60 * 1000); // 수업 전날
  const y = prev.getUTCFullYear();
  const m = String(prev.getUTCMonth() + 1).padStart(2, '0');
  const d = String(prev.getUTCDate()).padStart(2, '0');
  return { scheduledDate: `${y}-${m}-${d} 18:00:00`, atMs: new Date(`${y}-${m}-${d}T18:00:00+09:00`).getTime() };
}

function kstReviewSchedule(classDate: string, endTime: string): { scheduledDate: string; atMs: number } | null {
  const hm = String(endTime || '').slice(0, 5);
  if (!classDate || !/^\d{2}:\d{2}$/.test(hm)) return null;
  return { scheduledDate: `${classDate} ${hm}:00`, atMs: new Date(`${classDate}T${hm}:00+09:00`).getTime() };
}

// "2026-06-06" + "10:00" + "13:00" → "26년 6월 6일 10시~1시(3시간)"
function formatSchedule(dateStr: string, startTime: string, endTime: string): string {
  const parts = String(dateStr || '').split('-');
  if (parts.length !== 3) return String(dateStr || '');
  const yy = parts[0].slice(2);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const to12 = (h: number) => { const x = h % 12; return x === 0 ? 12 : x; };
  const label = (t: string) => {
    const h = Number(String(t).slice(0, 2));
    const m = Number(String(t).slice(3, 5));
    return m ? `${to12(h)}시 ${m}분` : `${to12(h)}시`;
  };
  let timeText = label(startTime);
  if (endTime) {
    const startMin = Number(String(startTime).slice(0, 2)) * 60 + Number(String(startTime).slice(3, 5));
    let durMin = (Number(String(endTime).slice(0, 2)) * 60 + Number(String(endTime).slice(3, 5))) - startMin;
    if (durMin < 0) durMin += 24 * 60;
    const dh = Math.floor(durMin / 60);
    const dm = durMin % 60;
    const durText = dm ? `${dh}시간 ${dm}분` : `${dh}시간`;
    timeText = `${label(startTime)}~${label(endTime)}(${durText})`;
  }
  return `${yy}년 ${month}월 ${day}일 ${timeText}`;
}

async function classInfo(classId: string): Promise<{ label: string; place: string; class_date: string; end_time: string }> {
  if (!classId) return { label: '', place: '', class_date: '', end_time: '' };
  const rows = await supabaseFetch(`classes?id=eq.${encodeURIComponent(classId)}&select=class_date,start_time,end_time,place`);
  if (Array.isArray(rows) && rows[0]) {
    return {
      label: formatSchedule(rows[0].class_date, rows[0].start_time, rows[0].end_time),
      place: rows[0].place || '근력학교 고대점',
      class_date: String(rows[0].class_date || ''),
      end_time: String(rows[0].end_time || ''),
    };
  }
  return { label: '', place: '', class_date: '', end_time: '' };
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

async function bulkApprove(classId: string, password: string) {
  if (!classId) throw new Error('classId is required');
  // 선착순(신청 시간순)으로, 예약 가능 인원(capacity)에서 이미 확정된 인원을 뺀 만큼을
  // '결제 안내 대상(payment_target)'으로 지정하고, 초과분은 자동으로 '대기(waitlisted)'로 저장한다.
  const classRows = await supabaseFetch(`classes?id=eq.${encodeURIComponent(classId)}&select=capacity`);
  const capacity = Array.isArray(classRows) && classRows[0] ? Number(classRows[0].capacity || 0) : 0;
  const info = await classInfo(classId);
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
    // 선착순 통과(결제 안내 대상)에게만 결제 안내 문자 자동 발송. 대기자는 발송하지 않는다.
    if (i < remaining) await notify(password, reservation, 'payment 안내', { class_date: info.label, place: info.place, payment_url: PAYMENT_LINK });
  }
  return { ok: true, capacity, remaining, approved, waitlisted };
}

// 이미 발송/예약된 후속 문자 타입 집합(결제 완료 재클릭 시 중복 예약 방지).
async function alreadyScheduledTypes(reservationId: string): Promise<Set<string>> {
  const rows = await supabaseFetch(`message_logs?reservation_id=eq.${encodeURIComponent(reservationId)}&message_type=in.(class_reminder,review_material)&status=in.(sent,scheduled)&select=message_type`);
  const set = new Set<string>();
  if (Array.isArray(rows)) for (const r of rows) set.add(String(r.message_type));
  return set;
}

// 결제 완료 시 리마인드(전날 18시)·복습(종료 시각)을 Solapi 예약 발송으로 등록.
async function scheduleFollowups(password: string, reservation: Record<string, unknown>, info: { label: string; place: string; class_date: string; end_time: string }) {
  if (!reservation || !reservation.id || !info.class_date) return;
  const done = await alreadyScheduledTypes(String(reservation.id));
  const now = Date.now();
  const reminder = kstReminderSchedule(info.class_date);
  if (reminder && reminder.atMs > now && !done.has('class_reminder')) {
    await notify(password, reservation, 'class_reminder', { class_date: info.label, place: info.place }, reminder.scheduledDate);
  }
  const review = kstReviewSchedule(info.class_date, info.end_time);
  if (review && review.atMs > now && !done.has('review_material')) {
    await notify(password, reservation, 'review_material', { class_date: info.label, place: info.place }, review.scheduledDate);
  }
}

// 취소/만료 시 해당 예약의 예약된 리마인드·복습 문자를 Solapi에서 취소.
async function cancelScheduledFollowups(password: string, reservationId: string) {
  if (!reservationId) return;
  const rows = await supabaseFetch(`message_logs?reservation_id=eq.${encodeURIComponent(reservationId)}&status=eq.scheduled&message_type=in.(class_reminder,review_material)&select=id,provider_message_id`);
  if (!Array.isArray(rows)) return;
  const { url, serviceKey } = getSupabaseAdmin();
  for (const row of rows) {
    const groupId = String(row.provider_message_id || '');
    if (!groupId) continue;
    try {
      const res = await fetch(`${url}/functions/v1/solapi-reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ password, cancelGroupId: groupId }),
      });
      const result = await res.json().catch(() => ({ ok: false }));
      if (result && result.ok) {
        await supabaseFetch(`message_logs?id=eq.${encodeURIComponent(String(row.id))}`, {
          method: 'PATCH',
          headers: { prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'cancelled' }),
        });
      }
    } catch (_) {
      // 취소 실패는 무시(베스트 에포트)
    }
  }
}

async function updateReservation(reservationId: string, updates: Record<string, unknown>, password: string, notifyOverride?: string) {
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
  const updated = Array.isArray(reservation) ? reservation[0] : reservation;

  // 상태 전환에 맞춰 안내 문자 발송/예약/취소 (베스트 에포트)
  if (updated) {
    if (updated.payment_status === 'expired') {
      const info = await classInfo(String(updated.class_id || ''));
      await notify(password, updated, 'payment_expired', { class_date: info.label, place: info.place });
      await cancelScheduledFollowups(password, String(updated.id));
    } else if (updated.reservation_status === 'cancelled') {
      await cancelScheduledFollowups(password, String(updated.id));
    } else if (updated.reservation_status === 'payment_target' || updated.payment_status === 'sent') {
      const info = await classInfo(String(updated.class_id || ''));
      const messageType = notifyOverride === 'seat_opened' ? 'seat_opened' : 'payment 안내';
      await notify(password, updated, messageType, { class_date: info.label, place: info.place, payment_url: PAYMENT_LINK });
    } else if (updated.reservation_status === 'confirmed' || updated.payment_status === 'paid') {
      const info = await classInfo(String(updated.class_id || ''));
      await notify(password, updated, 'payment_completed', { class_date: info.label, place: info.place });
      await scheduleFollowups(password, updated, info);
    }
  }
  return { ok: true, reservation: updated };
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
    if (action === 'bulkApprove') return jsonResponse(await bulkApprove(String(body.classId || ''), password));
    if (action === 'updateReservation') {
      return jsonResponse(await updateReservation(String(body.reservationId || ''), body.updates || {}, password, body.notify ? String(body.notify) : undefined));
    }

    return jsonResponse({ error: 'unknown action' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    const status = message === 'invalid password' ? 401 : 500;
    return jsonResponse({ ok: false, error: message }, status);
  }
});
