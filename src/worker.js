const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers || {}) },
  });
}

function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function randomToken(bytes = 24) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return base64url(b);
}

async function readJson(request) {
  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return null;
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function requireEnv(env, key) {
  if (!env[key]) throw new Error(`Missing required secret/var: ${key}`);
}

function requireBinding(env, key) {
  if (!env[key]) throw new Error(`Missing required binding: ${key}`);
}

async function tgCall(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const msg = data.description || `Telegram API error on ${method}`;
    throw new Error(msg);
  }
  return data.result;
}

async function tgSendMessage(env, chat_id, text, extra = {}) {
  return tgCall(env, 'sendMessage', {
    chat_id,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

async function tgSendPhoto(env, chat_id, photo, caption, extra = {}) {
  return tgCall(env, 'sendPhoto', {
    chat_id,
    photo,
    caption,
    parse_mode: 'HTML',
    ...extra,
  });
}

function kb(buttonRows) {
  return { reply_markup: { inline_keyboard: buttonRows } };
}

function mainMenu() {
  return kb([
    [{ text: 'Create store', callback_data: 'menu:create' }],
    [{ text: 'Link channel', callback_data: 'menu:link' }, { text: 'Add product', callback_data: 'menu:add' }],
    [{ text: 'Dashboard link', callback_data: 'menu:dashboard' }],
  ]);
}

async function getState(env, userId) {
  const raw = await env.STATE.get(`state:${userId}`);
  return raw ? JSON.parse(raw) : null;
}

async function setState(env, userId, state) {
  await env.STATE.put(`state:${userId}`, JSON.stringify(state), { expirationTtl: 1800 }); // 30 mins
}

async function clearState(env, userId) {
  await env.STATE.delete(`state:${userId}`);
}

/**
 * ✅ Cloudflare D1: NO stmt.limit()
 */
async function dbOne(stmt) {
  if (typeof stmt.first === 'function') {
    const row = await stmt.first();
    return row ?? null;
  }
  const out = await stmt.all();
  return out.results?.[0] || null;
}

function bearerToken(request) {
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

async function authStore(env, request) {
  const url = new URL(request.url);
  const token = bearerToken(request) || url.searchParams.get('token') || '';
  if (!token) return null;
  return dbOne(env.DB.prepare('SELECT * FROM stores WHERE owner_token = ?').bind(token));
}

function notFound() {
  return new Response('Not Found', { status: 404 });
}

function methodNotAllowed() {
  return new Response('Method Not Allowed', { status: 405 });
}

/* -----------------------------
   Analytics helpers
------------------------------ */
function clampPeriod(period) {
  const p = String(period || '').toLowerCase();
  if (p === '7d' || p === '30d' || p === '90d') return p;
  return '30d';
}
function daysForPeriod(p) {
  if (p === '7d') return 7;
  if (p === '90d') return 90;
  return 30;
}
function pctChange(current, previous) {
  const c = Number(current || 0);
  const p = Number(previous || 0);
  if (p === 0 && c === 0) return 0;
  if (p === 0) return 100;
  return ((c - p) / p) * 100;
}
function asNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function handleAnalytics(env, store, request) {
  if (request.method !== 'GET') return methodNotAllowed();

  const url = new URL(request.url);
  const period = clampPeriod(url.searchParams.get('period'));
  const days = daysForPeriod(period);

  const curAgg = await dbOne(env.DB.prepare(`
    SELECT
      COUNT(*) AS orders_total,
      COALESCE(SUM(p.price * o.qty), 0) AS revenue_total,
      SUM(CASE WHEN o.status = 'pending' THEN 1 ELSE 0 END) AS pending_total
    FROM orders o
    LEFT JOIN products p ON p.id = o.product_id
    WHERE o.store_id = ?
      AND o.created_at >= datetime('now', ?)
  `).bind(store.id, `-${days} days`));

  const prevAgg = await dbOne(env.DB.prepare(`
    SELECT
      COUNT(*) AS orders_total,
      COALESCE(SUM(p.price * o.qty), 0) AS revenue_total,
      SUM(CASE WHEN o.status = 'pending' THEN 1 ELSE 0 END) AS pending_total
    FROM orders o
    LEFT JOIN products p ON p.id = o.product_id
    WHERE o.store_id = ?
      AND o.created_at >= datetime('now', ?)
      AND o.created_at <  datetime('now', ?)
  `).bind(store.id, `-${days * 2} days`, `-${days} days`));

  const curProducts = await dbOne(env.DB.prepare(`
    SELECT COUNT(*) AS products_total
    FROM products
    WHERE store_id = ?
      AND created_at >= datetime('now', ?)
  `).bind(store.id, `-${days} days`));

  const prevProducts = await dbOne(env.DB.prepare(`
    SELECT COUNT(*) AS products_total
    FROM products
    WHERE store_id = ?
      AND created_at >= datetime('now', ?)
      AND created_at <  datetime('now', ?)
  `).bind(store.id, `-${days * 2} days`, `-${days} days`));

  const seriesRes = await env.DB.prepare(`
    SELECT
      strftime('%Y-%m-%d', o.created_at) AS day,
      COUNT(*) AS count
    FROM orders o
    WHERE o.store_id = ?
      AND o.created_at >= datetime('now', ?)
    GROUP BY day
    ORDER BY day ASC
  `).bind(store.id, `-${days} days`).all();

  const labels = [];
  const values = [];
  const map = new Map((seriesRes.results || []).map(r => [r.day, asNumber(r.count)]));
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));

  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const key = `${y}-${m}-${dd}`;
    labels.push(key);
    values.push(map.get(key) || 0);
  }

  const orders_total = asNumber(curAgg?.orders_total);
  const revenue_total = asNumber(curAgg?.revenue_total);
  const pending_total = asNumber(curAgg?.pending_total);
  const products_total = asNumber(curProducts?.products_total);

  const orders_prev = asNumber(prevAgg?.orders_total);
  const revenue_prev = asNumber(prevAgg?.revenue_total);
  const pending_prev = asNumber(prevAgg?.pending_total);
  const products_prev = asNumber(prevProducts?.products_total);

  const analytics = {
    period,
    days,
    orders_total,
    orders_change_pct: pctChange(orders_total, orders_prev),
    revenue_total,
    revenue_change_pct: pctChange(revenue_total, revenue_prev),
    pending_total,
    pending_change_pct: pctChange(pending_total, pending_prev),
    products_total,
    products_change_pct: pctChange(products_total, products_prev),
    series: { labels, values },
  };

  return json({ ok: true, analytics });
}

async function handleApi(env, request) {
  const url = new URL(request.url);
  const path = url.pathname;

  const store = await authStore(env, request);
  if (!store) return json({ ok: false, error: 'unauthorized' }, { status: 401 });

  if (path === '/api/analytics') {
    return handleAnalytics(env, store, request);
  }

  if (path === '/api/store') {
    if (request.method !== 'GET') return methodNotAllowed();
    return json({
      ok: true,
      store: {
        id: store.id,
        name: store.name,
        currency: store.currency,
        delivery_note: store.delivery_note,
        channel_id: store.channel_id,
        channel_username: store.channel_username,
        bank_name: store.bank_name || '',
        account_number: store.account_number || '',
        account_name: store.account_name || '',
      },
    });
  }

  // ✅ NEW: Save bank details (dashboard Settings tab)
  if (path === '/api/store/bank') {
    if (request.method !== 'PUT') return methodNotAllowed();

    const body = await readJson(request);
    if (!body) return json({ ok: false, error: 'invalid_json' }, { status: 400 });

    const bank_name = String(body.bank_name || '').trim();
    const account_number = String(body.account_number || '').trim();
    const account_name = String(body.account_name || '').trim();

    if (!bank_name || !account_number || !account_name) {
      return json({ ok: false, error: 'all_fields_required' }, { status: 400 });
    }

    if (!/^\d{10}$/.test(account_number)) {
      return json({ ok: false, error: 'account_number_invalid' }, { status: 400 });
    }

    await env.DB.prepare(
      'UPDATE stores SET bank_name = ?, account_number = ?, account_name = ? WHERE id = ?'
    ).bind(bank_name, account_number, account_name, store.id).run();

    return json({ ok: true });
  }

  if (path === '/api/products') {
    if (request.method === 'GET') {
      const res = await env.DB.prepare(
        'SELECT * FROM products WHERE store_id = ? ORDER BY created_at DESC'
      ).bind(store.id).all();
      return json({ ok: true, products: res.results || [] });
    }

    if (request.method === 'POST') {
      const body = await readJson(request);
      if (!body) return json({ ok: false, error: 'invalid_json' }, { status: 400 });

      const id = crypto.randomUUID();
      const name = String(body.name || '').trim();
      const price = Number(body.price || 0);
      const description = String(body.description || '').trim();
      const in_stock = body.in_stock ? 1 : 0;
      const photo_file_id = String(body.photo_file_id || '').trim() || null;

      if (!name) return json({ ok: false, error: 'name_required' }, { status: 400 });

      await env.DB.prepare(
        'INSERT INTO products (id, store_id, name, price, description, in_stock, photo_file_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime("now"))'
      ).bind(id, store.id, name, price, description, in_stock, photo_file_id).run();

      return json({ ok: true, id });
    }

    return methodNotAllowed();
  }

  const prodMatch = path.match(/^\/api\/products\/([^\/]+)$/);
  if (prodMatch) {
    const productId = prodMatch[1];
    if (request.method !== 'PUT') return methodNotAllowed();

    const body = await readJson(request);
    if (!body) return json({ ok: false, error: 'invalid_json' }, { status: 400 });

    const name = String(body.name || '').trim();
    const price = Number(body.price || 0);
    const description = String(body.description || '').trim();
    const in_stock = body.in_stock ? 1 : 0;
    const photo_file_id = String(body.photo_file_id || '').trim() || null;

    await env.DB.prepare(
      'UPDATE products SET name = ?, price = ?, description = ?, in_stock = ?, photo_file_id = ? WHERE id = ? AND store_id = ?'
    ).bind(name, price, description, in_stock, photo_file_id, productId, store.id).run();

    return json({ ok: true });
  }

  if (path === '/api/orders') {
    if (request.method !== 'GET') return methodNotAllowed();
    const res = await env.DB.prepare(
      'SELECT o.*, p.name AS product_name, p.price AS product_price FROM orders o LEFT JOIN products p ON p.id = o.product_id WHERE o.store_id = ? ORDER BY o.created_at DESC'
    ).bind(store.id).all();
    return json({ ok: true, orders: res.results || [] });
  }

  const ordMatch = path.match(/^\/api\/orders\/([^\/]+)\/status$/);
  if (ordMatch) {
    if (request.method !== 'PUT') return methodNotAllowed();

    const orderId = ordMatch[1];
    const body = await readJson(request);
    const status = String(body?.status || '').trim();
    if (!status) return json({ ok: false, error: 'status_required' }, { status: 400 });

    await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ? AND store_id = ?')
      .bind(status, orderId, store.id).run();

    return json({ ok: true });
  }

  return notFound();
}

async function ensureStoreExists(env, ownerId) {
  return dbOne(
    env.DB.prepare('SELECT * FROM stores WHERE owner_id = ? ORDER BY created_at DESC LIMIT 1')
      .bind(String(ownerId))
  );
}

function dashboardLink(env, owner_token) {
  const base = env.APP_BASE_URL || '';
  return `${base.replace(/\/$/, '')}/?token=${encodeURIComponent(owner_token)}`;
}

function getBotUsername(env) {
  const raw = String(env.BOT_USERNAME || '').trim();
  return raw.replace(/^@/, '');
}

function orderDeepLink(env, productId) {
  const u = getBotUsername(env);
  if (!u) return null;
  return `https://t.me/${u}?start=order_${encodeURIComponent(productId)}`;
}

function moneyAmount(storeCurrency, amount) {
  const cur = storeCurrency || '';
  return `${cur}${amount}`;
}

/* -----------------------------
   Manual transfer helpers
------------------------------ */
function payMenu(orderId) {
  return kb([
    [{ text: "I've paid ✅", callback_data: `pay:paid:${orderId}` }],
    [{ text: "Cancel", callback_data: `pay:cancel:${orderId}` }],
  ]);
}

function sellerPayReviewMenu(paymentId) {
  return kb([
    [{ text: '✅ Confirm payment', callback_data: `pay:approve:${paymentId}` }],
    [{ text: '❌ Reject', callback_data: `pay:reject:${paymentId}` }],
  ]);
}

async function sendPaymentInstructions(env, buyerChatId, store, product, qty, orderId) {
  const total = asNumber(product.price) * asNumber(qty);
  const hasBank = store.bank_name && store.account_number && store.account_name;

  if (!hasBank) {
    await tgSendMessage(
      env,
      buyerChatId,
      `Order created ✅\n\n<b>${escapeHtml(product.name)}</b>\nQty: ${qty}\nTotal: <b>${escapeHtml(moneyAmount(store.currency, total))}</b>\nRef: <code>${orderId}</code>\n\n⚠️ Seller hasn’t set bank details yet. The seller will contact you for payment.`,
      {}
    );
    return;
  }

  const text =
    `Order created ✅\n\n` +
    `<b>${escapeHtml(product.name)}</b>\n` +
    `Qty: ${qty}\n` +
    `Total: <b>${escapeHtml(moneyAmount(store.currency, total))}</b>\n` +
    `Ref: <code>${orderId}</code>\n\n` +
    `<b>Pay via bank transfer:</b>\n` +
    `Bank: <b>${escapeHtml(store.bank_name)}</b>\n` +
    `Account: <b>${escapeHtml(store.account_number)}</b>\n` +
    `Name: <b>${escapeHtml(store.account_name)}</b>\n\n` +
    `After paying, tap <b>I've paid</b> and upload your receipt/proof.`;

  await tgSendMessage(env, buyerChatId, text, payMenu(orderId));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

async function handleTelegram(env, request) {
  const update = await request.json().catch(() => null);
  if (!update) return json({ ok: true });

  const message = update.message;
  const cb = update.callback_query;

  if (message) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    const textMsg = (message.text || '').trim();

    const stateEarly = await getState(env, userId);

    // ✅ If user is in "send payment proof" state, handle proof upload here
    if (stateEarly?.step === 'pay:proof') {
      const orderId = stateEarly.data?.order_id;
      if (!orderId) {
        await clearState(env, userId);
        await tgSendMessage(env, chatId, 'Session expired. Please order again.');
        return json({ ok: true });
      }

      const photos = message.photo || null;
      const doc = message.document || null;

      let proof_file_id = null;
      let proof_type = null;

      if (photos && photos.length) {
        proof_file_id = photos[photos.length - 1].file_id;
        proof_type = 'photo';
      } else if (doc?.file_id) {
        proof_file_id = doc.file_id;
        proof_type = 'document';
      }

      if (!proof_file_id) {
        await tgSendMessage(env, chatId, 'Please upload a screenshot/photo or document as proof of payment.');
        return json({ ok: true });
      }

      const order = await dbOne(env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId));
      if (!order) {
        await clearState(env, userId);
        await tgSendMessage(env, chatId, 'Order not found.');
        return json({ ok: true });
      }

      const store = await dbOne(env.DB.prepare('SELECT * FROM stores WHERE id = ?').bind(order.store_id));
      const product = await dbOne(env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(order.product_id));
      const amount = asNumber(product?.price) * asNumber(order.qty);

      const paymentId = crypto.randomUUID();

      await env.DB.prepare(`
        INSERT INTO payments (id, order_id, store_id, buyer_id, buyer_username, amount, proof_file_id, proof_type, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'awaiting', datetime("now"))
      `).bind(
        paymentId,
        orderId,
        order.store_id,
        String(userId),
        String(message.from.username || ''),
        amount,
        proof_file_id,
        proof_type
      ).run();

      await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ? AND store_id = ?')
        .bind('awaiting_confirmation', orderId, order.store_id).run();

      await clearState(env, userId);

      await tgSendMessage(
        env,
        chatId,
        `Proof received ✅\nRef: <code>${escapeHtml(orderId)}</code>\n\nWaiting for seller confirmation.`,
        {}
      );

      const ownerChatId = Number(store.owner_id);
      const caption =
        `Payment to verify ⏳\n\n` +
        `Store: <b>${escapeHtml(store.name)}</b>\n` +
        `Product: <b>${escapeHtml(product?.name || '')}</b>\n` +
        `Qty: ${escapeHtml(order.qty)}\n` +
        `Amount: <b>${escapeHtml(moneyAmount(store.currency, amount))}</b>\n` +
        `Buyer: ${message.from.username ? '@' + escapeHtml(message.from.username) : escapeHtml(String(userId))}\n` +
        `Order Ref: <code>${escapeHtml(orderId)}</code>`;

      try {
        if (proof_type === 'photo') {
          await tgSendPhoto(env, ownerChatId, proof_file_id, caption, sellerPayReviewMenu(paymentId));
        } else {
          await tgSendMessage(
            env,
            ownerChatId,
            `${caption}\n\nProof (document file_id): <code>${escapeHtml(proof_file_id)}</code>\n\nConfirm/reject below.`,
            sellerPayReviewMenu(paymentId)
          );
        }
      } catch {}

      return json({ ok: true });
    }

    // Handle order quantity state FIRST
    if (stateEarly?.step === 'order:qty') {
      await handleTelegramOrderQty(env, message);
      return json({ ok: true });
    }

    // /start OR /start payload
    if (textMsg.startsWith('/start')) {
      await clearState(env, userId);

      const parts = textMsg.split(' ');
      const payload = (parts[1] || '').trim();

      if (payload.startsWith('order_')) {
        const productId = payload.slice('order_'.length);
        const product = await dbOne(env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(productId));

        if (!product) {
          await tgSendMessage(env, chatId, 'That product no longer exists.');
          return json({ ok: true });
        }
        if (!product.in_stock) {
          await tgSendMessage(env, chatId, 'This product is currently out of stock.');
          return json({ ok: true });
        }

        await setState(env, userId, { step: 'order:qty', data: { product_id: productId } });
        await tgSendMessage(env, chatId, `Ordering: <b>${escapeHtml(product.name)}</b>\n\nQuantity? (e.g. 1)`);
        return json({ ok: true });
      }

      await tgSendMessage(
        env,
        chatId,
        'Welcome to <b>Orderlyy</b>\n\nCreate a store, link your channel, and add products — all inside Telegram.',
        mainMenu()
      );
      return json({ ok: true });
    }

    return json({ ok: true });
  }

  if (cb) {
    const userId = cb.from.id;
    const chatId = cb.from.id;
    const data = cb.data || '';

    try { await tgCall(env, 'answerCallbackQuery', { callback_query_id: cb.id }); } catch {}

    if (data === 'menu:create') {
      await setState(env, userId, { step: 'create:name', data: {} });
      await tgSendMessage(env, chatId, 'Store name?');
      return json({ ok: true });
    }

    if (data === 'menu:link') {
      await setState(env, userId, { step: 'link:channel', data: {} });
      await tgSendMessage(env, chatId, 'Send your channel @username OR forward a message.\n\nAlso: add me as <b>Admin</b> in the channel first.');
      return json({ ok: true });
    }

    if (data === 'menu:add') {
      const store = await ensureStoreExists(env, userId);
      if (!store) {
        await tgSendMessage(env, chatId, 'Create a store first.', mainMenu());
        return json({ ok: true });
      }
      if (!store.channel_id) {
        await tgSendMessage(env, chatId, 'Link your channel first, then add products.', mainMenu());
        return json({ ok: true });
      }
      await setState(env, userId, { step: 'product:photo', data: {} });
      await tgSendMessage(env, chatId, 'Send product photo, or type /skip');
      return json({ ok: true });
    }

    if (data === 'menu:dashboard') {
      const store = await ensureStoreExists(env, userId);
      if (!store) {
        await tgSendMessage(env, chatId, 'Create a store first.', mainMenu());
        return json({ ok: true });
      }
      const link = dashboardLink(env, store.owner_token);
      await tgSendMessage(env, chatId, `Dashboard link:\n${link}`);
      return json({ ok: true });
    }

    const paidMatch = data.match(/^pay:paid:(.+)$/);
    if (paidMatch) {
      const orderId = paidMatch[1];

      const order = await dbOne(env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId));
      if (!order || String(order.buyer_id) !== String(userId)) {
        await tgSendMessage(env, chatId, 'Order not found or not yours.');
        return json({ ok: true });
      }

      await setState(env, userId, { step: 'pay:proof', data: { order_id: orderId } });
      await tgSendMessage(env, chatId, 'Upload proof of payment (screenshot/photo or document).');
      return json({ ok: true });
    }

    const cancelMatch = data.match(/^pay:cancel:(.+)$/);
    if (cancelMatch) {
      const orderId = cancelMatch[1];
      await clearState(env, userId);
      await tgSendMessage(env, chatId, `Cancelled. Ref: <code>${escapeHtml(orderId)}</code>`);
      return json({ ok: true });
    }

    const approveMatch = data.match(/^pay:approve:(.+)$/);
    if (approveMatch) {
      const paymentId = approveMatch[1];

      const payment = await dbOne(env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(paymentId));
      if (!payment) {
        await tgSendMessage(env, chatId, 'Payment not found.');
        return json({ ok: true });
      }

      const store = await dbOne(env.DB.prepare('SELECT * FROM stores WHERE id = ?').bind(payment.store_id));
      if (!store || String(store.owner_id) !== String(userId)) {
        await tgSendMessage(env, chatId, 'Not allowed.');
        return json({ ok: true });
      }

      await env.DB.prepare('UPDATE payments SET status = ? WHERE id = ?')
        .bind('confirmed', paymentId).run();

      await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ? AND store_id = ?')
        .bind('paid', payment.order_id, payment.store_id).run();

      try {
        await tgSendMessage(env, Number(payment.buyer_id), `Payment confirmed ✅\nOrder Ref: <code>${escapeHtml(payment.order_id)}</code>\n\nSeller will process your order now.`);
      } catch {}

      await tgSendMessage(env, chatId, `Confirmed ✅\nOrder Ref: <code>${escapeHtml(payment.order_id)}</code>`);
      return json({ ok: true });
    }

    const rejectMatch = data.match(/^pay:reject:(.+)$/);
    if (rejectMatch) {
      const paymentId = rejectMatch[1];

      const payment = await dbOne(env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(paymentId));
      if (!payment) {
        await tgSendMessage(env, chatId, 'Payment not found.');
        return json({ ok: true });
      }

      const store = await dbOne(env.DB.prepare('SELECT * FROM stores WHERE id = ?').bind(payment.store_id));
      if (!store || String(store.owner_id) !== String(userId)) {
        await tgSendMessage(env, chatId, 'Not allowed.');
        return json({ ok: true });
      }

      await env.DB.prepare('UPDATE payments SET status = ? WHERE id = ?')
        .bind('rejected', paymentId).run();

      await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ? AND store_id = ?')
        .bind('pending', payment.order_id, payment.store_id).run();

      try {
        await tgSendMessage(env, Number(payment.buyer_id), `Payment rejected ❌\nOrder Ref: <code>${escapeHtml(payment.order_id)}</code>\n\nPlease tap the payment button again and resend proof.`);
      } catch {}

      await tgSendMessage(env, chatId, `Rejected ❌\nOrder Ref: <code>${escapeHtml(payment.order_id)}</code>`);
      return json({ ok: true });
    }

    const orderMatch = data.match(/^order:(.+)$/);
    if (orderMatch) {
      const productId = orderMatch[1];
      const product = await dbOne(env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(productId));
      if (!product) {
        await tgSendMessage(env, chatId, 'This product no longer exists.');
        return json({ ok: true });
      }
      if (!product.in_stock) {
        await tgSendMessage(env, chatId, 'This product is currently out of stock.');
        return json({ ok: true });
      }

      await setState(env, userId, { step: 'order:qty', data: { product_id: productId } });
      await tgSendMessage(env, chatId, `Ordering: <b>${escapeHtml(product.name)}</b>\n\nQuantity? (e.g. 1)`);
      return json({ ok: true });
    }

    return json({ ok: true });
  }

  return json({ ok: true });
}

async function handleTelegramOrderQty(env, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const qty = Number((message.text || '').trim());

  const state = await getState(env, userId);
  if (!state || state.step !== 'order:qty') return false;

  if (!Number.isFinite(qty) || qty <= 0) {
    await tgSendMessage(env, chatId, 'Send a valid quantity (e.g. 1).');
    return true;
  }

  const productId = state.data.product_id;
  const product = await dbOne(env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(productId));
  if (!product) {
    await clearState(env, userId);
    await tgSendMessage(env, chatId, 'Product not found.');
    return true;
  }

  const store = await dbOne(env.DB.prepare('SELECT * FROM stores WHERE id = ?').bind(product.store_id));
  const orderId = crypto.randomUUID();

  await env.DB.prepare(
    'INSERT INTO orders (id, store_id, product_id, buyer_id, buyer_username, qty, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime("now"))'
  ).bind(orderId, store.id, productId, String(userId), String(message.from.username || ''), qty, 'pending').run();

  await clearState(env, userId);

  await sendPaymentInstructions(env, chatId, store, product, qty, orderId);

  try {
    const ownerChatId = Number(store.owner_id);
    await tgSendMessage(
      env,
      ownerChatId,
      `New order ✅\n\n<b>${escapeHtml(product.name)}</b>\nQty: ${qty}\nBuyer: @${escapeHtml(message.from.username || 'unknown')}\nRef: <code>${orderId}</code>\n\nWaiting for payment proof...`
    );
  } catch {}

  return true;
}

async function debugHealth(env) {
  const out = {
    ok: true,
    has: {
      TELEGRAM_BOT_TOKEN: !!env.TELEGRAM_BOT_TOKEN,
      APP_BASE_URL: !!env.APP_BASE_URL,
      BOT_USERNAME: !!env.BOT_USERNAME,
      DB: !!env.DB,
      STATE: !!env.STATE,
    },
    db: {
      canQuery: false,
      tables: [],
      error: null,
    },
  };

  try {
    const res = await env.DB.prepare('SELECT name FROM sqlite_master WHERE type="table" ORDER BY name').all();
    out.db.canQuery = true;
    out.db.tables = (res.results || []).map((r) => r.name);
  } catch (e) {
    out.db.error = String(e?.message || e);
  }

  return out;
}

export default {
  async fetch(request, env, ctx) {
    try {
      requireEnv(env, 'TELEGRAM_BOT_TOKEN');
      requireEnv(env, 'APP_BASE_URL');
      requireBinding(env, 'DB');
      requireBinding(env, 'STATE');

      const url = new URL(request.url);

      if (url.pathname === '/debug/health') {
        const h = await debugHealth(env);
        return json(h);
      }

      if (url.pathname === '/telegram/webhook') {
        if (request.method !== 'POST') return methodNotAllowed();
        return handleTelegram(env, request);
      }

      if (url.pathname.startsWith('/api/')) {
        return handleApi(env, request);
      }

      return notFound();
    } catch (e) {
      console.error('WORKER_ERROR', e);
      return json(
        { ok: false, error: 'server_error', detail: String(e?.message || e) },
        { status: 500 }
      );
    }
  },
};