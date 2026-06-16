import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

// 공개 예약 조회 엔드포인트: 이름 + 전화번호가 모두 일치하는 본인 신청 내역만 반환한다.
// 개인 대기 순번·내부 메모 등은 노출하지 않고, 고객용 상태 라벨로만 보여준다.

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });
}

function getSupabaseAdmin() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) throw new Error('Supabase admin secrets are not configured');
  return { url: url.replace(/\/$/, ''), serviceKey };
}

async function supabaseFetch(path: string) {
  const { url, serviceKey } = getSupabaseAdmin();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Supabase request failed: ${response.status}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// "2026-06-20" + "10:00" + "13:00" → "26년 6월 20일 10시~1시(3시간)"
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

// 고객용 상태키(라벨/안내 문구의 기준). 대기 순번 등 내부 정보는 노출하지 않음.
function customerStatusKey(r: Record<string, unknown>): string {
  if (r.reservation_status === 'cancelled') return 'cancelled';
  if (r.reservation_status === 'no_show') return 'no_show';
  if (r.reservation_status === 'confirmed' || r.payment_status === 'paid') return 'confirmed';
  if (r.reservation_status === 'payment_target' || r.payment_status === 'sent') return 'payment_target';
  if (r.reservation_status === 'waitlisted') return 'waitlisted';
  return 'applied';
}

// 고객용 상태 라벨(대기 순번 등 내부 정보는 노출하지 않음).
function customerStatusLabel(key: string): string {
  switch (key) {
    case 'cancelled': return '취소됨';
    case 'no_show': return '불참 처리';
    case 'confirmed': return '예약 확정 (결제 완료)';
    case 'payment_target': return '결제 안내 대상 — 안내 문자를 확인해 주세요';
    case 'waitlisted': return '대기 중 (여석이 생기면 안내드립니다)';
    default: return '신청 접수됨 (순서가 되면 안내드립니다)';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const applicantName = String(body.applicant_name || '').trim();
    const phone = String(body.phone || '').replace(/[^0-9]/g, '');

    if (!applicantName) return jsonResponse({ ok: false, error: '이름을 입력해 주세요.' }, 400);
    if (!/^010\d{8}$/.test(phone)) return jsonResponse({ ok: false, error: '휴대폰 번호를 확인해 주세요. (010으로 시작하는 11자리)' }, 400);

    // 이름+전화가 모두 일치하는 본인 신청만 조회(공개 수업만, classes 임베드).
    const rows = await supabaseFetch(
      `reservations?applicant_name=eq.${encodeURIComponent(applicantName)}&phone=eq.${encodeURIComponent(phone)}` +
      `&select=id,reservation_status,payment_status,created_at,class:classes(class_date,start_time,end_time,place,is_public,status)` +
      `&order=created_at.desc`
    );

    const list = (Array.isArray(rows) ? rows : [])
      .filter((r: Record<string, unknown>) => r.class && (r.class as Record<string, unknown>).is_public === true)
      .map((r: Record<string, unknown>) => {
        const c = r.class as Record<string, string>;
        const key = customerStatusKey(r);
        return {
          reservation_id: r.id,
          class_label: formatSchedule(c.class_date, c.start_time, c.end_time),
          place: c.place || '근력학교 고대점',
          status_key: key,
          status_label: customerStatusLabel(key),
          created_at: r.created_at,
          // 결제 완료/취소/불참 전까지는 본인이 직접 예약을 취소할 수 있다.
          cancellable: key === 'applied' || key === 'waitlisted' || key === 'payment_target',
        };
      });

    return jsonResponse({ ok: true, reservations: list });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
