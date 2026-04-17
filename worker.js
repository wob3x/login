// Cloudflare Worker: security telemetry (visit + login_attempt) -> Telegram admins
//
// Required env vars:
// - BOT_TOKEN (secret)
// - ALLOWED_ORIGINS (csv)
//
// Admin delivery options:
// - ADMIN_CHAT_ID (csv list, optional but recommended)
// - SUPPORT_KV (KV binding, optional for dynamic admin join)
// - ADMIN_JOIN_PASSWORD (secret, optional for /admin join via Telegram)

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function escapeHtml(input) {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin) return origin;
  const referer = request.headers.get("Referer");
  if (!referer) return "";
  try {
    return new URL(referer).origin;
  } catch {
    return "";
  }
}

function isAllowedOrigin(origin, allowedCsv) {
  if (!origin || !allowedCsv) return false;
  return String(allowedCsv)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .includes(origin);
}

function corsFor(request, env) {
  const origin = getOrigin(request);
  const allowed = isAllowedOrigin(origin, env.ALLOWED_ORIGINS || "");
  if (!allowed) return { allowed: false, headers: {} };
  return {
    allowed: true,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  };
}

function parseCsvToSet(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  );
}

async function getAdminChatIds(env) {
  const adminSet = parseCsvToSet(env.ADMIN_CHAT_ID);
  if (env.SUPPORT_KV) {
    const list = await env.SUPPORT_KV.list({ prefix: "admin:" });
    for (const key of list.keys) {
      adminSet.add(key.name.replace("admin:", ""));
    }
  }
  return [...adminSet];
}

async function addAdmin(chatId, env) {
  if (!env.SUPPORT_KV) return false;
  await env.SUPPORT_KV.put(`admin:${chatId}`, "1");
  return true;
}

async function sendTelegramMessage(chatId, text, env) {
  const tgUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  return fetch(tgUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}

async function notifyAdmins(text, env) {
  const admins = await getAdminChatIds(env);
  for (const chatId of admins) {
    await sendTelegramMessage(chatId, text, env);
  }
}

function ensureJsonRequest(request) {
  const contentType = request.headers.get("Content-Type") || "";
  return contentType.includes("application/json");
}

function getClientMeta(request) {
  const cf = request.cf || {};
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown";

  return {
    ip,
    asn: String(cf.asn || "unknown"),
    asOrganization: cf.asOrganization || "unknown",
    colo: cf.colo || "unknown",
    continent: cf.continent || "unknown",
    country: request.headers.get("CF-IPCountry") || cf.country || "unknown",
    city: cf.city || "unknown",
    region: cf.region || "unknown",
    regionCode: cf.regionCode || "unknown",
    postalCode: cf.postalCode || "unknown",
    latitude: cf.latitude || "unknown",
    longitude: cf.longitude || "unknown",
    timezone: cf.timezone || "unknown",
    ua: request.headers.get("User-Agent") || "unknown",
    acceptLanguage: request.headers.get("Accept-Language") || "unknown",
    accept: request.headers.get("Accept") || "unknown",
    secChUa: request.headers.get("Sec-CH-UA") || "unknown",
    secChUaMobile: request.headers.get("Sec-CH-UA-Mobile") || "unknown",
    secChUaPlatform: request.headers.get("Sec-CH-UA-Platform") || "unknown",
    referer: request.headers.get("Referer") || "none",
    cfVisitor: request.headers.get("CF-Visitor") || "unknown",
    xForwardedProto: request.headers.get("X-Forwarded-Proto") || "unknown",
    ray: request.headers.get("CF-Ray") || "unknown",
    when: new Date().toISOString(),
  };
}

function formatVisitText(meta, body) {
  const browser = body?.browser || {};
  return [
    "🟢 <b>Visit</b>",
    "",
    `🌐 <b>Page:</b> <code>${escapeHtml(body?.page || "unknown")}</code>`,
    `🧾 <b>Title:</b> <code>${escapeHtml(browser.title || "unknown")}</code>`,
    `🕒 <b>Time (UTC):</b> <code>${escapeHtml(meta.when)}</code>`,
    "",
    `👤 <b>IP:</b> <code>${escapeHtml(meta.ip)}</code>`,
    `🛰 <b>ASN:</b> <code>${escapeHtml(meta.asn)} (${escapeHtml(meta.asOrganization)})</code>`,
    `📍 <b>Geo:</b> <code>${escapeHtml(meta.continent)} / ${escapeHtml(meta.country)} / ${escapeHtml(meta.region)} / ${escapeHtml(meta.city)}</code>`,
    `🧭 <b>RegionCode/Postal:</b> <code>${escapeHtml(meta.regionCode)} / ${escapeHtml(meta.postalCode)}</code>`,
    `🗺 <b>Lat/Lon:</b> <code>${escapeHtml(meta.latitude)}, ${escapeHtml(meta.longitude)}</code>`,
    `🏢 <b>CF Colo:</b> <code>${escapeHtml(meta.colo)}</code>`,
    `🕓 <b>CF Timezone:</b> <code>${escapeHtml(meta.timezone)}</code>`,
    "",
    `📱 <b>User-Agent:</b> <code>${escapeHtml(meta.ua)}</code>`,
    `🗣 <b>Accept-Language:</b> <code>${escapeHtml(meta.acceptLanguage)}</code>`,
    `📥 <b>Accept:</b> <code>${escapeHtml(meta.accept)}</code>`,
    `🧪 <b>Sec-CH-UA:</b> <code>${escapeHtml(meta.secChUa)}</code>`,
    `📲 <b>Sec-CH-UA-Mobile:</b> <code>${escapeHtml(meta.secChUaMobile)}</code>`,
    `💻 <b>Sec-CH-UA-Platform:</b> <code>${escapeHtml(meta.secChUaPlatform)}</code>`,
    "",
    `🖥 <b>Browser TZ:</b> <code>${escapeHtml(browser.timezone || "unknown")}</code>`,
    `🌍 <b>Browser Lang:</b> <code>${escapeHtml(browser.language || "unknown")}</code>`,
    `🧷 <b>Browser Platform:</b> <code>${escapeHtml(browser.platform || "unknown")}</code>`,
    `📐 <b>Viewport:</b> <code>${escapeHtml(browser.viewport || "unknown")}</code>`,
    `🖼 <b>Screen:</b> <code>${escapeHtml(browser.screen || "unknown")}</code>`,
    `🔗 <b>Browser Referrer:</b> <code>${escapeHtml(browser.referrer || "none")}</code>`,
    `🔁 <b>Header Referer:</b> <code>${escapeHtml(meta.referer)}</code>`,
    "",
    `☁️ <b>CF-Ray:</b> <code>${escapeHtml(meta.ray)}</code>`,
    `🔒 <b>X-Forwarded-Proto:</b> <code>${escapeHtml(meta.xForwardedProto)}</code>`,
    `🧱 <b>CF-Visitor:</b> <code>${escapeHtml(meta.cfVisitor)}</code>`,
  ].join("\n");
}

function formatLoginAttemptText(meta, body) {
  const browser = body?.browser || {};
  const email = String(body?.email || "").trim().toLowerCase();
  return [
    "🟠 <b>Login Attempt</b>",
    "",
    `📧 <b>Email:</b> <code>${escapeHtml(email || "unknown")}</code>`,
    `📝 <b>Event:</b> <code>${escapeHtml(body?.note || "submit")}</code>`,
    `🌐 <b>Page:</b> <code>${escapeHtml(browser.page || "unknown")}</code>`,
    `🕒 <b>Time (UTC):</b> <code>${escapeHtml(meta.when)}</code>`,
    "",
    `👤 <b>IP:</b> <code>${escapeHtml(meta.ip)}</code>`,
    `🛰 <b>ASN:</b> <code>${escapeHtml(meta.asn)} (${escapeHtml(meta.asOrganization)})</code>`,
    `📍 <b>Geo:</b> <code>${escapeHtml(meta.continent)} / ${escapeHtml(meta.country)} / ${escapeHtml(meta.region)} / ${escapeHtml(meta.city)}</code>`,
    `🏢 <b>CF Colo:</b> <code>${escapeHtml(meta.colo)}</code>`,
    `🕓 <b>CF Timezone:</b> <code>${escapeHtml(meta.timezone)}</code>`,
    "",
    `📱 <b>User-Agent:</b> <code>${escapeHtml(meta.ua)}</code>`,
    `🗣 <b>Accept-Language:</b> <code>${escapeHtml(meta.acceptLanguage)}</code>`,
    `🧪 <b>Sec-CH-UA:</b> <code>${escapeHtml(meta.secChUa)}</code>`,
    `💻 <b>Sec-CH-UA-Platform:</b> <code>${escapeHtml(meta.secChUaPlatform)}</code>`,
    "",
    `🖥 <b>Browser TZ:</b> <code>${escapeHtml(browser.timezone || "unknown")}</code>`,
    `🌍 <b>Browser Lang:</b> <code>${escapeHtml(browser.language || "unknown")}</code>`,
    `🧷 <b>Browser Platform:</b> <code>${escapeHtml(browser.platform || "unknown")}</code>`,
    `📐 <b>Viewport:</b> <code>${escapeHtml(browser.viewport || "unknown")}</code>`,
    `🖼 <b>Screen:</b> <code>${escapeHtml(browser.screen || "unknown")}</code>`,
    "",
    `☁️ <b>CF-Ray:</b> <code>${escapeHtml(meta.ray)}</code>`,
  ].join("\n");
}

async function handleVisit(request, env, cors) {
  if (!ensureJsonRequest(request)) {
    return json({ success: false, error: "Unsupported Media Type" }, 415, cors.headers);
  }
  const body = await request.json().catch(() => null);
  const meta = getClientMeta(request);
  const text = formatVisitText(meta, body || {});
  await notifyAdmins(text, env);
  return json({ success: true }, 200, cors.headers);
}

async function handleLoginAttempt(request, env, cors) {
  if (!ensureJsonRequest(request)) {
    return json({ success: false, error: "Unsupported Media Type" }, 415, cors.headers);
  }
  const body = await request.json().catch(() => null);
  const email = String(body?.email || "").trim();
  if (!email) {
    return json({ success: false, error: "email is required" }, 400, cors.headers);
  }
  const meta = getClientMeta(request);
  const text = formatLoginAttemptText(meta, body || {});
  await notifyAdmins(text, env);
  return json({ success: true }, 200, cors.headers);
}

async function handleWebhook(request, env) {
  const update = await request.json().catch(() => null);
  if (!update?.message?.chat?.id) return json({ ok: true });

  const chatId = String(update.message.chat.id);
  const text = String(update.message.text || "").trim();
  if (!text) return json({ ok: true });

  if (text.startsWith("/start")) {
    const msg = [
      "👋 Admin bot is active.",
      "",
      "To join admins, send:",
      "<code>/admin YOUR_PASSWORD</code>",
    ].join("\n");
    await sendTelegramMessage(chatId, msg, env);
    return json({ ok: true });
  }

  if (text.startsWith("/admin")) {
    const pass = text.split(" ").slice(1).join(" ").trim();
    if (!env.ADMIN_JOIN_PASSWORD) {
      await sendTelegramMessage(chatId, "❌ ADMIN_JOIN_PASSWORD is not configured.", env);
      return json({ ok: true });
    }
    if (pass !== env.ADMIN_JOIN_PASSWORD) {
      await sendTelegramMessage(chatId, "❌ Invalid admin password.", env);
      return json({ ok: true });
    }

    const saved = await addAdmin(chatId, env);
    if (saved) {
      await sendTelegramMessage(chatId, "✅ You have been added to admins.", env);
    } else {
      await sendTelegramMessage(
        chatId,
        "⚠️ SUPPORT_KV is not configured. Add your chat id manually to ADMIN_CHAT_ID.",
        env
      );
    }
    return json({ ok: true });
  }

  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    if (!env.BOT_TOKEN) {
      return json({ success: false, error: "BOT_TOKEN is missing" }, 500);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/telegram/webhook" && request.method === "POST") {
      return handleWebhook(request, env);
    }

    if (path === "/telegram/set-webhook" && request.method === "POST") {
      const webhookUrl = `${url.origin}/telegram/webhook`;
      const resp = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ url: webhookUrl }),
      });
      const data = await resp.json().catch(() => ({}));
      return json({ success: resp.ok, telegram: data }, resp.ok ? 200 : 502);
    }

    const cors = corsFor(request, env);

    if (request.method === "OPTIONS") {
      if (!cors.allowed) return new Response("Forbidden", { status: 403 });
      return new Response(null, { status: 204, headers: cors.headers });
    }

    if (!cors.allowed) {
      return json({ success: false, error: "Forbidden: Invalid Origin" }, 403);
    }

    if (request.method !== "POST") {
      return json({ success: false, error: "Method Not Allowed" }, 405, cors.headers);
    }

    if (path === "/api/visit") {
      return handleVisit(request, env, cors);
    }

    if (path === "/api/login-attempt") {
      return handleLoginAttempt(request, env, cors);
    }

    return json({ success: false, error: "Not Found" }, 404, cors.headers);
  },
};

