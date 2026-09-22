// Посредник между формами сайта Триггер Бара, Telegram и почтой бара.
//
// Зачем он нужен: чтобы написать в Telegram, нужен токен бота, а чтобы отправить
// письмо — пароль от почтового ящика. Код сайта видит любой посетитель через
// «Посмотреть код страницы», поэтому класть их туда нельзя. Они лежат в секретах
// Cloudflare, сюда приходят в env и наружу не показываются.
//
// У каждой формы свой канал:
//
//   бронь стола      →  Telegram   (сотрудник видит сразу, бронь срочная)
//   вопрос с сайта   →  почта info@triggerpub.ru  (можно ответить не спеша)

import { WorkerMailer } from 'worker-mailer';

// Отсюда воркер принимает заявки. Чужой сайт вызвать его не сможет.
const ALLOWED_ORIGINS = [
  'https://triggerpub.ru',
  'https://www.triggerpub.ru',
  'https://rossovaulia8-eng-yulia-sites-831f.twc1.net',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

// Ограничения длины: защита от того, что в форму вставят «простыню» текста.
const LIMITS = { name: 80, phone: 30, contact: 120, message: 1500, guests: 3, time: 5 };

// Почта. Хост именно server262.hosting.reg.ru, а не mail.triggerpub.ru:
// сертификат хостинга выдан на *.hosting.reg.ru, и по другому имени соединение
// оборвётся из-за несовпадения имени. Порт 465 — шифрование сразу при подключении.
// Логин и пароль лежат в секретах (SMTP_USER, SMTP_PASS), в коде их нет.
const MAIL_HOST = 'server262.hosting.reg.ru';
const MAIL_PORT = 465;
const MAIL_TO = 'info@triggerpub.ru';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);

    // Браузер перед POST на чужой адрес шлёт пробный запрос OPTIONS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
    }
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'method' }, 405, origin, allowed);
    }
    if (!allowed) {
      return json({ ok: false, error: 'origin' }, 403, origin, false);
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ ok: false, error: 'badjson' }, 400, origin, allowed);
    }

    // Ловушка для спам-ботов: скрытое поле, которое живой гость не видит и не
    // заполняет. Заполнено — молча отвечаем «ок», чтобы бот не подбирал обход.
    if (data.website) {
      return json({ ok: true }, 200, origin, allowed);
    }

    if (data.consent !== true) {
      return json({ ok: false, error: 'consent' }, 400, origin, allowed);
    }

    return data.form === 'booking'
      ? handleBooking(data, env, origin, allowed)
      : handleContact(data, env, origin, allowed);
  },
};

// Бронь стола → Telegram. Гость ждёт стол на конкретное время, поэтому канал
// один и быстрый: сотрудник видит заявку в группе через секунду.
async function handleBooking(data, env, origin, allowed) {
  const text = bookingText(data);
  if (!text) {
    return json({ ok: false, error: 'fields' }, 400, origin, allowed);
  }

  // Telegram может не ответить (сеть, лимиты). Тогда честно говорим сайту,
  // что не получилось: гость должен увидеть телефон, а не ложное «принято».
  let tg;
  try {
    tg = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
  } catch {
    return json({ ok: false, error: 'telegram' }, 502, origin, allowed);
  }

  if (!tg.ok) {
    // Текст ошибки пишем в лог воркера (wrangler tail), гостю его не показываем
    console.log('telegram error', tg.status, await tg.text());
    return json({ ok: false, error: 'telegram' }, 502, origin, allowed);
  }

  return json({ ok: true }, 200, origin, allowed);
}

// Вопрос с сайта → письмо на почту бара. Здесь письмо — единственный канал,
// поэтому ждём отправки и отвечаем сайту только после неё. Иначе гость увидит
// «сообщение отправлено», а вопрос растворится.
async function handleContact(data, env, origin, allowed) {
  const mail = contactMail(data);
  if (!mail) {
    return json({ ok: false, error: 'fields' }, 400, origin, allowed);
  }

  if (!env.SMTP_USER || !env.SMTP_PASS) {
    console.log('mail error: нет секретов SMTP_USER / SMTP_PASS');
    return json({ ok: false, error: 'mail' }, 502, origin, allowed);
  }

  try {
    await sendMail(env, mail);
  } catch (e) {
    // Причина видна в журнале: npx wrangler tail
    console.log('mail error', e && e.message);
    return json({ ok: false, error: 'mail' }, 502, origin, allowed);
  }

  return json({ ok: true }, 200, origin, allowed);
}

function bookingText(d) {
  const name = clean(d.name, LIMITS.name);
  const phone = clean(d.phone, LIMITS.phone);
  const date = clean(d.date, 10);
  const time = clean(d.time, LIMITS.time);
  if (!name || !phone || !date || !time) return null;

  const contactLabels = {
    phone: 'позвонить',
    telegram: 'Телеграм',
    whatsapp: 'Ватсап',
    max: 'Макс',
  };

  return [
    '<b>🍻 Бронь стола</b>',
    '',
    `<b>Гость:</b> ${name}`,
    `<b>Телефон:</b> ${phone}`,
    `<b>Когда:</b> ${formatDate(date)}, ${time}`,
    `<b>Гостей:</b> ${clean(d.guests, LIMITS.guests) || '—'}`,
    `<b>Связаться:</b> ${contactLabels[d.contact] || 'позвонить'}`,
  ].join('\n');
}

function contactMail(d) {
  const name = plain(d.name, LIMITS.name);
  const contact = plain(d.contact, LIMITS.contact);
  const message = plain(d.message, LIMITS.message);
  if (!name || !contact || !message) return null;

  return {
    // Тему видно в списке писем, поэтому имя гостя выносим прямо в неё.
    subject: `Вопрос с сайта — ${name}`,
    text: [
      'Вопрос через форму обратной связи на сайте',
      '',
      `Имя: ${name}`,
      `Связаться: ${contact}`,
      '',
      message,
      '',
      '—',
      'Письмо отправлено формой обратной связи на сайте triggerpub.ru',
    ].join('\n'),
    // Гость оставил почту — подставляем её в «Ответить», чтобы ответить можно
    // было одной кнопкой, не копируя адрес руками.
    reply: isEmail(contact) ? contact : undefined,
  };
}

async function sendMail(env, mail) {
  await WorkerMailer.send(
    {
      host: MAIL_HOST,
      port: MAIL_PORT,
      secure: true,
      credentials: { username: env.SMTP_USER, password: env.SMTP_PASS },
      // Сервер сам выберет тот способ входа, который поддерживает.
      authType: ['login', 'plain'],
    },
    {
      from: { name: 'Сайт Триггер Бара', email: env.SMTP_USER },
      to: { email: MAIL_TO },
      reply: mail.reply,
      subject: mail.subject,
      text: mail.text,
    },
  );
}

// Обрезаем по длине и экранируем < > &, иначе Telegram примет их за разметку
// и либо сломает сообщение, либо покажет не то, что написал гость.
function clean(value, max) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value)
    .trim()
    .slice(0, max)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// В письме < > & экранировать не нужно: это обычный текст, а не разметка.
function plain(value, max) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// 2026-09-25 -> 25.09.2026 (в Telegram так читается быстрее)
function formatDate(iso) {
  const p = iso.split('-');
  return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : iso;
}

function corsHeaders(origin, allowed) {
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status, origin, allowed) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
  });
}
