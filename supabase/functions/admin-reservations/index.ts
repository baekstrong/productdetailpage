import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createEvent, updateEvent, deleteEvent } from './calendar.ts';

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

// 취소·불참 예약은 정원/확정/대기 등 모든 인원 집계에서 제외한다.
function isCancelledRow(r: Record<string, unknown>): boolean {
  return r.reservation_status === 'cancelled' || r.reservation_status === 'no_show';
}

// solapi-reservations 호출 인증은 Bearer service_role 헤더(내부 호출)로 충분 — 비밀번호는 보내지 않는다.
async function sendSms(messageType: string, phone: string, values: Record<string, string>, scheduledAt?: string, overrideText?: string) {
  const { url, serviceKey } = getSupabaseAdmin();
  try {
    const response = await fetch(`${url}/functions/v1/solapi-reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ messageType, phone, values, scheduledAt, overrideText }),
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

async function notify(reservation: Record<string, unknown>, messageType: string, values: Record<string, string>, scheduledAt?: string, overrideText?: string) {
  const phone = String(reservation?.phone || '');
  if (!phone) return;
  const result = await sendSms(messageType, phone, values, scheduledAt, overrideText);
  await logMessage(String(reservation.id), messageType, phone, result as Record<string, unknown>, scheduledAt);
}

// 발송 전 미리보기 — solapi 함수에 preview 플래그로 요청해 실제 발송 없이 채워진 본문만 받는다.
// 관리자가 이 본문을 확인/수정한 뒤 messageText(override)로 다시 보내면 그대로 발송된다.
async function previewMessage(classId: string, messageType: string, videoUrl?: string) {
  const info = await classInfo(classId);
  const values: Record<string, string> = { class_date: info.label, place: info.place };
  if (messageType === 'payment 안내' || messageType === 'seat_opened') values.payment_url = PAYMENT_LINK;
  if (messageType === 'review_video') values.video_url = String(videoUrl || '').trim();
  const { url, serviceKey } = getSupabaseAdmin();
  const response = await fetch(`${url}/functions/v1/solapi-reservations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({ messageType, values, preview: true }),
  });
  return await response.json().catch(() => ({ ok: false, error: 'invalid solapi response' }));
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
  return { scheduledDate: `${y}-${m}-${d}T18:00:00+09:00`, atMs: new Date(`${y}-${m}-${d}T18:00:00+09:00`).getTime() };
}

function kstReviewSchedule(classDate: string, endTime: string): { scheduledDate: string; atMs: number } | null {
  const hm = String(endTime || '').slice(0, 5);
  if (!classDate || !/^\d{2}:\d{2}$/.test(hm)) return null;
  return { scheduledDate: `${classDate}T${hm}:00+09:00`, atMs: new Date(`${classDate}T${hm}:00+09:00`).getTime() };
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

const CLASS_FIELDS = ['class_date', 'start_time', 'end_time', 'place', 'capacity', 'is_public', 'status', 'preview_before_open'];
const CLASS_STATUSES = new Set(['open', 'waitlist', 'closed', 'hidden']);

function pickClassFields(input: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const key of CLASS_FIELDS) {
    if (input[key] === undefined || input[key] === null || input[key] === '') continue;
    if (key === 'capacity') row[key] = Number(input[key]);
    else if (key === 'is_public' || key === 'preview_before_open') row[key] = Boolean(input[key]);
    else row[key] = input[key];
  }
  // open_at은 빈값이면 NULL(즉시 오픈)로 명시 저장 — 화이트리스트 루프와 달리 '지우기'를 허용.
  if ('open_at' in input) row.open_at = input.open_at ? input.open_at : null;
  if (row.status !== undefined && !CLASS_STATUSES.has(String(row.status))) throw new Error('invalid class status');
  return row;
}

async function listAdminData() {
  // Admin uses the service role, so it reads the raw public.classes / public.reservations tables
  // directly (the anon-facing public.class_reservation_summary view hides non-public / hidden classes,
  // which the admin still needs to manage). Counts are computed here from the same data.
  const classes = await supabaseFetch('classes?select=*&order=class_date.asc,start_time.asc');
  const reservations = await supabaseFetch('reservations?select=*&order=created_at.asc');
  const messageLogs = await supabaseFetch('message_logs?select=reservation_id,message_type,status,scheduled_at,sent_at&order=created_at.asc');
  const classRows = Array.isArray(classes) ? classes : [];
  const reservationRows = Array.isArray(reservations) ? reservations : [];
  // 차단 명단·운영 설정은 부가 정보 — 조회 실패해도 관리자 화면 자체는 뜨도록 방어.
  let blockedPhones: unknown[] = [];
  let settings: Record<string, string> = {};
  try {
    const blocked = await supabaseFetch('blocked_phones?select=phone,reason,created_at');
    if (Array.isArray(blocked)) blockedPhones = blocked;
  } catch (_) { /* ignore */ }
  try {
    const settingRows = await supabaseFetch('app_settings?select=key,value');
    if (Array.isArray(settingRows)) for (const r of settingRows) settings[String(r.key)] = String(r.value);
  } catch (_) { /* ignore */ }

  const summary = classRows.map((c: Record<string, unknown>) => {
    const rows = reservationRows.filter((r: Record<string, unknown>) => r.class_id === c.id);
    // 취소·불참 건은 어떤 집계에도 포함하지 않는다(결제 완료 후 취소돼도 자리는 복구되어야 함).
    const confirmed = rows.filter((r) => !isCancelledRow(r) && (r.reservation_status === 'confirmed' || r.payment_status === 'paid')).length;
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
      open_at: c.open_at || null,
      preview_before_open: c.preview_before_open === true,
      is_open: c.open_at ? (new Date(String(c.open_at)).getTime() <= Date.now()) : true,
      confirmed_count: confirmed,
      // 남은 자리 = 정원 - 자리 점유자(확정 + 결제 안내 중) — 공개 뷰(class_reservation_summary)와 동일 기준.
      available_count: Math.max(Number(c.capacity || 0) - confirmed - paymentReady, 0),
      waitlist_count: waitlist,
      payment_ready_count: paymentReady,
    };
  });
  return {
    ok: true,
    classes: summary,
    reservations: reservationRows,
    message_logs: Array.isArray(messageLogs) ? messageLogs : [],
    blocked_phones: blockedPhones,
    settings,
  };
}

// --- 예약 거부(차단): 번호를 blocked_phones에 등록하고, 활성 예약은 조용히 취소(문자 없음) ---
async function blockPhones(reservationIds: string[]) {
  let blocked = 0;
  for (const id of reservationIds) {
    const rows = await supabaseFetch(`reservations?id=eq.${encodeURIComponent(id)}&select=*`);
    const reservation = Array.isArray(rows) ? rows[0] : rows;
    if (!reservation || !reservation.phone) continue;
    await supabaseFetch('blocked_phones?on_conflict=phone', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ phone: reservation.phone, reason: `관리자 예약 거부 (${reservation.applicant_name || ''})` }),
    });
    // 아직 활성 상태면 조용히 취소해 자리를 비운다(안내 문자·상태변경 트리거 없음) + 예약된 후속 문자 취소.
    if (reservation.reservation_status !== 'cancelled' && reservation.reservation_status !== 'no_show') {
      await supabaseFetch(`reservations?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ reservation_status: 'cancelled', updated_at: new Date().toISOString() }),
      });
      await cancelScheduledFollowups(id);
    }
    blocked += 1;
  }
  return { ok: true, blocked };
}

async function unblockPhone(phone: string) {
  if (!phone) throw new Error('phone is required');
  await supabaseFetch(`blocked_phones?phone=eq.${encodeURIComponent(phone)}`, { method: 'DELETE' });
  return { ok: true };
}

// --- 운영 설정 저장 (키 화이트리스트) ---
const SETTING_KEYS = new Set(['payment_deadline_hours']);

async function saveSetting(key: string, value: string) {
  if (!SETTING_KEYS.has(key)) throw new Error('invalid setting key');
  if (key === 'payment_deadline_hours') {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 72) throw new Error('결제 기한은 1~72 사이 정수(시간)로 입력하세요');
  }
  await supabaseFetch('app_settings?on_conflict=key', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, value: String(value), updated_at: new Date().toISOString() }),
  });
  return { ok: true, key, value: String(value) };
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
  const classRow = Array.isArray(created) ? created[0] : created;
  // 캘린더 이벤트 생성(베스트 에포트) 후 event_id 연결.
  if (classRow && classRow.id) {
    const eventId = await createEvent(classRow);
    if (eventId) {
      await supabaseFetch(`classes?id=eq.${encodeURIComponent(String(classRow.id))}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ google_event_id: eventId }),
      });
      classRow.google_event_id = eventId;
    }
  }
  return { ok: true, class: classRow };
}

async function updateClass(classId: string, updates: Record<string, unknown>) {
  if (!classId) throw new Error('classId is required');
  const row = pickClassFields(updates || {});
  row.updated_at = new Date().toISOString();
  // 수업 날짜를 바꾸면 결제 리마인더 이력을 초기화 — 새 날짜 기준 D-7에 다시 가도록.
  if (row.class_date !== undefined) row.payment_reminder_sent_at = null;
  const updated = await supabaseFetch(`classes?id=eq.${encodeURIComponent(classId)}&select=*`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  const classRow = Array.isArray(updated) ? updated[0] : updated;
  // 캘린더 반영(베스트 에포트): 이벤트가 있으면 갱신, 없으면 새로 생성 후 연결.
  if (classRow && classRow.id) {
    if (classRow.google_event_id) {
      await updateEvent(String(classRow.google_event_id), classRow);
    } else {
      const eventId = await createEvent(classRow);
      if (eventId) {
        await supabaseFetch(`classes?id=eq.${encodeURIComponent(String(classRow.id))}`, {
          method: 'PATCH',
          headers: { prefer: 'return=minimal' },
          body: JSON.stringify({ google_event_id: eventId }),
        });
        classRow.google_event_id = eventId;
      }
    }
  }
  return { ok: true, class: classRow };
}

async function deleteClass(classId: string, force = false) {
  if (!classId) throw new Error('classId is required');
  // 결제 완료(또는 확정) 예약이 있는 수업은 실수 삭제로 고객 데이터가 사라지지 않도록 기본 차단한다.
  // force=true(관리자가 한 번 더 확인)일 때만 허용.
  if (!force) {
    const paid = await supabaseFetch(
      `reservations?class_id=eq.${encodeURIComponent(classId)}&or=(reservation_status.eq.confirmed,payment_status.eq.paid)&select=id`,
    );
    if (Array.isArray(paid) && paid.length > 0) {
      throw new Error(`결제 완료 예약이 ${paid.length}건 있어 삭제가 차단되었습니다. 정말 삭제하려면 다시 한 번 확인해 주세요.`);
    }
  }
  // 삭제 전에 연결된 캘린더 이벤트 id를 확보해 캘린더에서도 제거(베스트 에포트).
  const rows = await supabaseFetch(`classes?id=eq.${encodeURIComponent(classId)}&select=google_event_id`);
  const eventId = Array.isArray(rows) && rows[0] ? String(rows[0].google_event_id || '') : '';
  if (eventId) await deleteEvent(eventId);
  // public.reservations rows for this class are removed via ON DELETE CASCADE.
  await supabaseFetch(`classes?id=eq.${encodeURIComponent(classId)}`, { method: 'DELETE' });
  return { ok: true };
}

// 아직 캘린더에 등록되지 않은(google_event_id 없는) 수업들을 일괄로 캘린더에 생성한다.
async function backfillCalendar() {
  const rows = await supabaseFetch('classes?google_event_id=is.null&select=*&order=class_date.asc');
  const list = Array.isArray(rows) ? rows : [];
  let created = 0;
  let failed = 0;
  for (const c of list) {
    const eventId = await createEvent(c);
    if (eventId) {
      await supabaseFetch(`classes?id=eq.${encodeURIComponent(String(c.id))}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ google_event_id: eventId }),
      });
      created += 1;
    } else {
      failed += 1;
    }
  }
  return { ok: true, total: list.length, created, failed };
}

async function bulkApprove(classId: string, messageText?: string) {
  if (!classId) throw new Error('classId is required');
  // 선착순(신청 시간순)으로, 예약 가능 인원(capacity)에서 이미 확정된 인원을 뺀 만큼을
  // '결제 안내 대상(payment_target)'으로 지정하고, 초과분은 자동으로 '대기(waitlisted)'로 저장한다.
  const classRows = await supabaseFetch(`classes?id=eq.${encodeURIComponent(classId)}&select=capacity`);
  const capacity = Array.isArray(classRows) && classRows[0] ? Number(classRows[0].capacity || 0) : 0;
  const info = await classInfo(classId);
  const reservations = await supabaseFetch(`reservations?class_id=eq.${encodeURIComponent(classId)}&select=*&order=created_at.asc`);
  const rows = Array.isArray(reservations) ? reservations : [];

  const confirmedCount = rows.filter((r) => !isCancelledRow(r) && (r.reservation_status === 'confirmed' || r.payment_status === 'paid')).length;
  // 이미 결제 안내 대상인 인원은 자리를 점유 중 — 재클릭 시 중복 문자/초과 승인 방지.
  const paymentTargetCount = rows.filter((r) => r.reservation_status === 'payment_target').length;
  const remaining = Math.max(capacity - confirmedCount - paymentTargetCount, 0);
  const candidates = rows.filter((r) =>
    r.reservation_status !== 'confirmed' && r.payment_status !== 'paid'
    && r.reservation_status !== 'payment_target'
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
    if (i < remaining) await notify(reservation, 'payment 안내', { class_date: info.label, place: info.place, payment_url: PAYMENT_LINK }, undefined, messageText);
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
async function scheduleFollowups(reservation: Record<string, unknown>, info: { label: string; place: string; class_date: string; end_time: string }) {
  if (!reservation || !reservation.id || !info.class_date) return;
  const done = await alreadyScheduledTypes(String(reservation.id));
  const now = Date.now();
  const reminder = kstReminderSchedule(info.class_date);
  if (!done.has('class_reminder')) {
    if (reminder && reminder.atMs > now) {
      await notify(reservation, 'class_reminder', { class_date: info.label, place: info.place }, reminder.scheduledDate);
    } else {
      // 발송 시각이 이미 지남 — 조용히 빠뜨리지 않고 skipped로 기록해 현황판에 노출.
      await logMessage(String(reservation.id), 'class_reminder', String(reservation.phone || ''), { ok: false, skipped: true, reason: '예약 발송 시각이 이미 지남' });
    }
  }
  const review = kstReviewSchedule(info.class_date, info.end_time);
  if (!done.has('review_material')) {
    if (review && review.atMs > now) {
      await notify(reservation, 'review_material', { class_date: info.label, place: info.place }, review.scheduledDate);
    } else {
      await logMessage(String(reservation.id), 'review_material', String(reservation.phone || ''), { ok: false, skipped: true, reason: '예약 발송 시각이 이미 지남' });
    }
  }
}

// 취소/만료 시 해당 예약의 예약된 문자(리마인드·복습·결제 리마인드)를 Solapi에서 취소.
// types를 지정하면 그 종류만 취소한다(예: 결제 완료 시 결제 리마인드만).
async function cancelScheduledFollowups(reservationId: string, types: string[] = ['class_reminder', 'review_material', 'payment_deadline_reminder']) {
  if (!reservationId) return;
  const typeList = types.join(',');
  const rows = await supabaseFetch(`message_logs?reservation_id=eq.${encodeURIComponent(reservationId)}&status=eq.scheduled&message_type=in.(${encodeURIComponent(typeList)})&select=id,provider_message_id`);
  if (!Array.isArray(rows)) return;
  const { url, serviceKey } = getSupabaseAdmin();
  for (const row of rows) {
    const groupId = String(row.provider_message_id || '');
    let cancelled = !groupId; // groupId가 없으면 원격 예약이 없으므로 로컬만 정리한다.
    let errorMessage: string | null = null;
    if (groupId) {
      try {
        const res = await fetch(`${url}/functions/v1/solapi-reservations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ cancelGroupId: groupId }),
        });
        const result = await res.json().catch(() => ({ ok: false }));
        cancelled = Boolean(result && result.ok);
        if (!cancelled) errorMessage = ((result && (result.error || result.reason)) as string) || 'cancel failed';
      } catch (e) {
        errorMessage = e instanceof Error ? e.message : 'cancel failed';
      }
    }
    // 성공이든 실패든 항상 기록을 갱신해 '예약 취소 실패로 그대로 발송될' 상태를 관측 가능하게 한다.
    await supabaseFetch(`message_logs?id=eq.${encodeURIComponent(String(row.id))}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify(cancelled ? { status: 'cancelled' } : { status: 'cancel_failed', error_message: errorMessage }),
    });
  }
}

// 재발송 가능한 자동 문자 종류 화이트리스트. custom은 관리자가 직접 작성한 본문을 그대로 보내는 자유 문자.
const RESENDABLE_TYPES = new Set(['reservation_received', 'payment 안내', 'seat_opened', 'seat_secured', 'payment_completed', 'class_reminder', 'review_material', 'review_video', 'reservation_cancelled', 'custom']);

// 현황판에서 미발송자에게 해당 종류 문자를 재발송한다.
async function resendMessage(classId: string, messageType: string, reservationIds: string[], videoUrl?: string, messageText?: string) {
  if (!RESENDABLE_TYPES.has(messageType)) throw new Error('invalid messageType');
  // 복습 영상은 수업마다 링크가 달라 관리자가 입력한 값을 받아 발송한다.
  const videoLink = String(videoUrl || '').trim();
  if (messageType === 'review_video' && !videoLink) throw new Error('복습 영상 링크가 필요합니다');
  // 직접 작성 문자는 템플릿이 없어 본문(messageText)이 반드시 있어야 한다.
  if (messageType === 'custom' && !String(messageText || '').trim()) throw new Error('문자 내용이 필요합니다');
  if (!Array.isArray(reservationIds) || !reservationIds.length) return { ok: true, sent: 0 };
  const info = await classInfo(classId);
  let sent = 0;
  for (const id of reservationIds) {
    const rows = await supabaseFetch(`reservations?id=eq.${encodeURIComponent(id)}&select=*`);
    const reservation = Array.isArray(rows) ? rows[0] : rows;
    if (!reservation) continue;
    if (messageType === 'class_reminder' || messageType === 'review_material') {
      const sched = messageType === 'class_reminder'
        ? kstReminderSchedule(info.class_date)
        : kstReviewSchedule(info.class_date, info.end_time);
      if (!sched || sched.atMs <= Date.now()) continue; // 예약 시각이 이미 지났으면 재예약 불가
      await notify(reservation, messageType, { class_date: info.label, place: info.place }, sched.scheduledDate, messageText);
    } else {
      const values: Record<string, string> = { class_date: info.label, place: info.place };
      if (messageType === 'payment 안내' || messageType === 'seat_opened') values.payment_url = PAYMENT_LINK;
      if (messageType === 'review_video') values.video_url = videoLink;
      await notify(reservation, messageType, values, undefined, messageText);
    }
    sent += 1;
  }
  return { ok: true, sent };
}

async function updateReservation(reservationId: string, updates: Record<string, unknown>, notifyOverride?: string, messageText?: string, silent = false) {
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
  // 이번 요청이 상태를 실제로 바꿨을 때만 문자 발송/예약/취소를 트리거한다.
  // (메모만 수정해도 현재 상태 기준으로 문자가 재발송되는 사고 방지)
  const statusChanged = 'reservation_status' in safeUpdates || 'payment_status' in safeUpdates;
  if (updated && statusChanged) {
    // 분기 우선순위: 미결제 마감은 reservation_status='cancelled'+payment_status='expired'가
    // 한 번에 오므로 expired를 먼저 매칭한다(만료 안내만 발송, 일반 취소 문자는 보내지 않음).
    // silent=true면 안내 문자 발송/예약은 건너뛰되, 걸려있던 예약 문자 취소 등 정리 작업은 그대로 수행한다.
    if (updated.payment_status === 'expired') {
      if (!silent) {
        const info = await classInfo(String(updated.class_id || ''));
        await notify(updated, 'payment_expired', { class_date: info.label, place: info.place }, undefined, messageText);
      }
      await cancelScheduledFollowups(String(updated.id));
    } else if (updated.payment_status === 'refunded') {
      // 환불 처리: cancelled+refunded가 한 번에 오므로 취소보다 먼저 매칭(환불 안내만 발송, 일반 취소 문자 X).
      if (!silent) {
        const info = await classInfo(String(updated.class_id || ''));
        await notify(updated, 'payment_refunded', { class_date: info.label, place: info.place }, undefined, messageText);
      }
      await cancelScheduledFollowups(String(updated.id));
    } else if (updated.reservation_status === 'cancelled') {
      if (!silent) {
        const info = await classInfo(String(updated.class_id || ''));
        await notify(updated, 'reservation_cancelled', { class_date: info.label, place: info.place }, undefined, messageText);
      }
      await cancelScheduledFollowups(String(updated.id));
    } else if (updated.reservation_status === 'payment_target' || updated.payment_status === 'sent') {
      if (!silent) {
        const info = await classInfo(String(updated.class_id || ''));
        // 결제 전 자리 확보(seat_secured)는 결제 링크 없이 안내한다. 그 외엔 결제 링크 포함.
        if (notifyOverride === 'seat_secured') {
          await notify(updated, 'seat_secured', { class_date: info.label, place: info.place }, undefined, messageText);
        } else {
          const messageType = notifyOverride === 'seat_opened' ? 'seat_opened' : 'payment 안내';
          await notify(updated, messageType, { class_date: info.label, place: info.place, payment_url: PAYMENT_LINK }, undefined, messageText);
        }
      }
    } else if (updated.reservation_status === 'confirmed' || updated.payment_status === 'paid') {
      // 결제가 끝났으니 아직 안 나간 결제 리마인드는 취소한다(문자 없이 처리해도 수행).
      await cancelScheduledFollowups(String(updated.id), ['payment_deadline_reminder']);
      if (!silent) {
        const info = await classInfo(String(updated.class_id || ''));
        await notify(updated, 'payment_completed', { class_date: info.label, place: info.place }, undefined, messageText);
        // 후속 리마인드/복습 예약 문자는 템플릿 그대로 예약 발송한다(수정 본문은 즉시 발송분에만 적용).
        await scheduleFollowups(updated, info);
      }
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
    if (action === 'deleteClass') return jsonResponse(await deleteClass(String(body.classId || ''), Boolean(body.force)));
    if (action === 'backfillCalendar') return jsonResponse(await backfillCalendar());
    if (action === 'blockPhones') return jsonResponse(await blockPhones(Array.isArray(body.reservationIds) ? body.reservationIds.map(String) : []));
    if (action === 'unblockPhone') return jsonResponse(await unblockPhone(String(body.phone || '')));
    if (action === 'saveSetting') return jsonResponse(await saveSetting(String(body.key || ''), String(body.value || '')));
    if (action === 'bulkApprove') return jsonResponse(await bulkApprove(String(body.classId || ''), body.messageText ? String(body.messageText) : undefined));
    if (action === 'previewMessage') {
      return jsonResponse(await previewMessage(String(body.classId || ''), String(body.messageType || ''), body.videoUrl ? String(body.videoUrl) : undefined));
    }
    if (action === 'updateReservation') {
      return jsonResponse(await updateReservation(
        String(body.reservationId || ''),
        body.updates || {},
        body.notify ? String(body.notify) : undefined,
        body.messageText ? String(body.messageText) : undefined,
        Boolean(body.silent),
      ));
    }
    if (action === 'resendMessage') {
      return jsonResponse(await resendMessage(
        String(body.classId || ''),
        String(body.messageType || ''),
        Array.isArray(body.reservationIds) ? body.reservationIds.map(String) : [],
        body.videoUrl ? String(body.videoUrl) : undefined,
        body.messageText ? String(body.messageText) : undefined,
      ));
    }

    return jsonResponse({ error: 'unknown action' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    const status = message === 'invalid password' ? 401 : 500;
    return jsonResponse({ ok: false, error: message }, status);
  }
});
