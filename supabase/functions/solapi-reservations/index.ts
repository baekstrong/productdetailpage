import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

type MessageType =
  | 'reservation_received'
  | 'payment 안내'
  | 'seat_opened'
  | 'payment_completed'
  | 'class_reminder'
  | 'review_material';

const templates: Record<MessageType, string> = {
  // 예약 신청 완료 문자
  reservation_received: '[근력학교] 케틀벨 원데이 수업 예약 신청이 접수되었습니다. 결제 안내를 받으신 뒤 결제까지 완료되어야 자리가 확정됩니다.',
  // 결제 안내 문자
  'payment 안내': '[근력학교] 케틀벨 원데이 수업 결제 순서가 되었습니다. 아래 링크에서 결제를 완료해주세요. 결제 완료 시 자리가 확정됩니다. 결제 링크: {payment_url}',
  // 여석 안내 문자
  seat_opened: '[근력학교] 신청하신 케틀벨 원데이 수업에 여석이 생겼습니다. 아래 링크에서 결제하시면 자리가 확정됩니다. 결제 링크: {payment_url}',
  // 결제 완료 문자
  payment_completed: '[근력학교] 케틀벨 원데이 수업 예약이 확정되었습니다. 일정: {class_date} / 장소: 근력학교 고대점 / 준비물: 편한 복장, 물',
  // 수업 전 리마인드 문자
  class_reminder: '[근력학교] 내일 케틀벨 원데이 수업이 진행됩니다. 일정: {class_date} / 장소: 근력학교 고대점 / 준비물: 편한 복장, 물',
  // 수업 후 복습 자료 문자
  review_material: '[근력학교] 오늘 수업 고생하셨습니다. 복습용 교재 링크를 보내드립니다. 링크: {notion_url}',
  // 복습 영상은 백관장 수동 발송
};

function fillTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template);
}

function maskPhone(phone: string): string {
  return phone.replace(/^(010)(\d{4})(\d{4})$/, '$1-****-$3');
}

async function sendSolapi(to: string, text: string, scheduledAt?: string) {
  const SOLAPI_API_KEY = Deno.env.get('SOLAPI_API_KEY');
  const SOLAPI_API_SECRET = Deno.env.get('SOLAPI_API_SECRET');
  const SOLAPI_SENDER = Deno.env.get('SOLAPI_SENDER');
  if (!SOLAPI_API_KEY || !SOLAPI_API_SECRET || !SOLAPI_SENDER) {
    return { ok: false, skipped: true, reason: 'Solapi secrets are not configured', to: maskPhone(to), text };
  }

  // Production implementation should create Solapi HMAC auth headers here.
  // The function is intentionally server-side only so SOLAPI_API_KEY / SOLAPI_API_SECRET never reach admin.html.
  return {
    ok: true,
    provider: 'solapi',
    to: maskPhone(to),
    from: SOLAPI_SENDER,
    scheduledAt,
    text,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  const messageType = body.messageType as MessageType;
  const phone = String(body.phone || '');
  const scheduledAt = body.scheduledAt ? String(body.scheduledAt) : undefined;
  const values = body.values || {};

  if (!templates[messageType]) {
    return new Response(JSON.stringify({ error: 'unknown message type' }), { status: 400, headers: { ...corsHeaders, 'content-type': 'application/json' } });
  }
  if (!phone) {
    return new Response(JSON.stringify({ error: 'phone is required' }), { status: 400, headers: { ...corsHeaders, 'content-type': 'application/json' } });
  }

  const text = fillTemplate(templates[messageType], values);
  const result = await sendSolapi(phone, text, scheduledAt);

  return new Response(JSON.stringify({ ...result, messageType, phoneMasked: maskPhone(phone) }), { status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' } });
});
