// src/_worker.js — Complete Edge Router for periish.lol on Cloudflare Pages + Workers KV
import * as db from "./database.js";

// ── Cookie Session Helpers ────────────────────────────────────────
async function getSession(request, secret) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/periish_session=([^;]+)/);
  if (!match) return {};
  try {
    const raw = decodeURIComponent(match[1]);
    const [payloadBase64, signature] = raw.split('.');
    if (!payloadBase64 || !signature) return {};
    
    // Verify HMAC if secret is available
    if (secret) {
      const expectedSig = await signHmac(payloadBase64, secret);
      if (signature !== expectedSig) return {};
    }
    return JSON.parse(atob(payloadBase64));
  } catch (err) {
    return {};
  }
}

async function setSessionCookie(sessionData, secret) {
  const payloadBase64 = btoa(JSON.stringify(sessionData));
  const signature = secret ? await signHmac(payloadBase64, secret) : 'nosig';
  const val = encodeURIComponent(`${payloadBase64}.${signature}`);
  return `periish_session=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;
}

function clearSessionCookie() {
  return `periish_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

async function signHmac(data, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function jsonResponse(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}

// ── Discord HTTPS Helpers for Edge ────────────────────────────────
async function fetchDiscordToken(clientId, clientSecret, code, redirectUri) {
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    })
  });
  return await res.json();
}

async function fetchDiscordUser(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return await res.json();
}

// ── Main Edge Worker Entry ────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const secret = env.SESSION_SECRET || 'periish-lol-super-secret-key-1337';
    let session = await getSession(request, secret);

    // Helper to return response saving current session
    const saveAndReturn = async (resOrPromise, newSession = session) => {
      const res = await resOrPromise;
      const cookieHeader = await setSessionCookie(newSession, secret);
      const headers = new Headers(res.headers);
      headers.set('Set-Cookie', cookieHeader);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    };

    // Ensure owner role setup right on first hit
    const OWNER_USERNAME = (env.OWNER_USERNAME || 'tul').toLowerCase();
    try {
      const owner = await db.getUserByUsername(env, OWNER_USERNAME);
      if (owner && owner.role !== 'owner') {
        await db.setUserRole(env, owner.id, 'owner');
      }
    } catch(e) {}

    // ════════════════════════════════════════════════════════════════
    //  API / AUTH ROUTES
    // ════════════════════════════════════════════════════════════════

    if (pathname === '/api/auth/me') {
      if (!session.userId) return jsonResponse({ loggedIn: false });
      const user = await db.getUserByUsername(env, session.username);
      if (!user || user.banned) {
        return new Response(JSON.stringify({ loggedIn: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookie() }
        });
      }
      const profile = await db.getProfileByUsername(env, user.username);
      return jsonResponse({
        loggedIn: true,
        user: {
          id: user.id, username: user.username, handle: user.handle || user.username,
          email: user.email, role: user.role,
          donated_amount: user.donated_amount || 0,
          store_purchases: user.store_purchases || [],
          discord_id: user.discord_id || null,
          discord_username: user.discord_username || null,
          discord_global_name: user.discord_global_name || null,
          discord_avatar: user.discord_avatar || null
        },
        profile
      });
    }

    if (pathname === '/api/auth/register' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { username, email, password, handle } = body;
      if (!username || !email || !password) return jsonResponse({ error: 'All fields required.' }, 400);
      try {
        const newUser = await db.createUser(env, username, email, password, handle || username);
        if (session.pendingDiscord) {
          try {
            await db.linkDiscord(env, newUser.id, session.pendingDiscord);
            session.pendingDiscord = null;
          } catch {}
        }
        session.userId = newUser.id;
        session.username = newUser.username;
        return await saveAndReturn(jsonResponse({ message: 'Account created!', username: newUser.username }, 201));
      } catch (err) {
        return jsonResponse({ error: err.message }, 400);
      }
    }

    if (pathname === '/api/auth/login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { usernameOrEmail, password } = body;
      if (!usernameOrEmail || !password) return jsonResponse({ error: 'All fields required.' }, 400);
      const bcrypt = require('bcryptjs');
      let user = (await db.getUserByUsername(env, usernameOrEmail)) || (await db.getUserByEmail(env, usernameOrEmail));
      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return jsonResponse({ error: 'Invalid credentials.' }, 401);
      }
      if (user.banned) return jsonResponse({ error: 'Account banned.' }, 403);
      if (session.pendingDiscord && !user.discord_id) {
        try {
          await db.linkDiscord(env, user.id, session.pendingDiscord);
          session.pendingDiscord = null;
        } catch {}
      }
      session.userId = user.id;
      session.username = user.username;
      return await saveAndReturn(jsonResponse({ message: 'Logged in!', username: user.username, role: user.role }));
    }

    if (pathname === '/api/auth/logout' && request.method === 'POST') {
      return new Response(JSON.stringify({ message: 'Logged out.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookie() }
      });
    }

    // ── Discord OAuth Routes ──
    if (pathname === '/api/discord/configured') {
      return jsonResponse({ configured: !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) });
    }

    if (pathname === '/api/discord/status') {
      if (!session.userId) return jsonResponse({ error: 'Unauthorized.' }, 401);
      const user = await db.getUserByUsername(env, session.username);
      if (!user) return jsonResponse({ error: 'User not found.' }, 404);
      return jsonResponse(user.discord_id
        ? { linked: true, discord_id: user.discord_id, discord_username: user.discord_username,
            discord_global_name: user.discord_global_name, discord_avatar: user.discord_avatar }
        : { linked: false }
      );
    }

    if (pathname === '/api/discord/unlink' && request.method === 'POST') {
      if (!session.userId) return jsonResponse({ error: 'Unauthorized.' }, 401);
      try {
        await db.unlinkDiscord(env, session.userId);
        return jsonResponse({ message: 'Discord unlinked.' });
      } catch (err) {
        return jsonResponse({ error: err.message }, 400);
      }
    }

    if (pathname === '/api/discord/pending') {
      if (session.pendingDiscord) {
        const d = session.pendingDiscord;
        const avatar = d.avatar
          ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/${parseInt(d.id) % 6}.png`;
        return jsonResponse({ pending: true, discord_id: d.id, discord_username: d.username,
          discord_global_name: d.global_name, discord_avatar: avatar, email: d.email });
      }
      return jsonResponse({ pending: false });
    }

    if (pathname === '/api/discord/pending/clear' && request.method === 'POST') {
      session.pendingDiscord = null;
      return await saveAndReturn(jsonResponse({ ok: true }));
    }

    if (pathname === '/auth/discord') {
      const DISCORD_CLIENT_ID = env.DISCORD_CLIENT_ID;
      const DISCORD_REDIRECT_URI = env.DISCORD_REDIRECT_URI || `${url.origin}/auth/discord/callback`;
      if (!DISCORD_CLIENT_ID) return Response.redirect(`${url.origin}/login?error=discord_not_configured`, 302);
      session.discordOAuthMode = url.searchParams.get('mode') || 'login';
      const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: DISCORD_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify email',
        prompt: 'none'
      });
      const redirectRes = Response.redirect(`https://discord.com/oauth2/authorize?${params}`, 302);
      return await saveAndReturn(redirectRes);
    }

    if (pathname === '/auth/discord/callback') {
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const DISCORD_CLIENT_ID = env.DISCORD_CLIENT_ID;
      const DISCORD_CLIENT_SECRET = env.DISCORD_CLIENT_SECRET;
      const DISCORD_REDIRECT_URI = env.DISCORD_REDIRECT_URI || `${url.origin}/auth/discord/callback`;

      if (error || !code) return Response.redirect(`${url.origin}/login?error=discord_denied`, 302);
      try {
        const tokenData = await fetchDiscordToken(DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, code, DISCORD_REDIRECT_URI);
        if (!tokenData.access_token) return Response.redirect(`${url.origin}/login?error=discord_token_failed`, 302);
        const discordUser = await fetchDiscordUser(tokenData.access_token);
        if (!discordUser?.id) return Response.redirect(`${url.origin}/login?error=discord_user_failed`, 302);

        if (session.userId) {
          try {
            await db.linkDiscord(env, session.userId, discordUser);
            return Response.redirect(`${url.origin}/dashboard?discord=linked`, 302);
          } catch (err) {
            return Response.redirect(`${url.origin}/dashboard?error=` + encodeURIComponent(err.message), 302);
          }
        }

        const existingUser = await db.getUserByDiscordId(env, discordUser.id);
        if (existingUser) {
          session.userId = existingUser.id;
          session.username = existingUser.username;
          return await saveAndReturn(Response.redirect(`${url.origin}/dashboard?discord=linked`, 302));
        }

        session.pendingDiscord = {
          id: discordUser.id,
          username: discordUser.username,
          global_name: discordUser.global_name || discordUser.username,
          avatar: discordUser.avatar,
          email: discordUser.email || null
        };

        const mode = session.discordOAuthMode || 'login';
        return await saveAndReturn(Response.redirect(mode === 'register' ? `${url.origin}/register?discord=connected` : `${url.origin}/login?discord=connected`, 302));
      } catch (err) {
        console.error('Discord OAuth error:', err);
        return Response.redirect(`${url.origin}/login?error=discord_error`, 302);
      }
    }

    // ── Profile API Routes ──
    if (pathname.startsWith('/api/profile/public/')) {
      const username = decodeURIComponent(pathname.replace('/api/profile/public/', ''));
      const profile = await db.getProfileByUsername(env, username);
      if (!profile) return jsonResponse({ error: 'Profile not found.' }, 404);
      const views = await db.incrementProfileViews(env, username);
      profile.views = views;
      return jsonResponse(profile);
    }

    if (pathname === '/api/profile/save' && request.method === 'POST') {
      if (!session.userId) return jsonResponse({ error: 'Unauthorized.' }, 401);
      const body = await request.json().catch(() => ({}));
      try {
        const profile = await db.saveProfile(env, session.userId, body);
        return jsonResponse({ message: 'Profile saved!', profile });
      } catch (err) {
        return jsonResponse({ error: err.message }, 400);
      }
    }

    // ── Leaderboard API Routes ──
    if (pathname === '/api/leaderboard') {
      const profiles = await db.getAllProfiles(env);
      return jsonResponse(profiles.sort((a, b) => b.views - a.views));
    }

    if (pathname === '/api/leaderboard/donors') {
      const donors = await db.getTopDonors(env, 100);
      return jsonResponse(donors);
    }

    // ── Store API Routes ──
    if (pathname === '/api/store/items') {
      const items = db.getStoreItems();
      if (session.userId) {
        const user = await db.getUserByUsername(env, session.username);
        const owned = user?.store_purchases || [];
        return jsonResponse(items.map(i => ({ ...i, owned: owned.includes(i.id) })));
      }
      return jsonResponse(items);
    }

    if (pathname === '/api/store/purchase' && request.method === 'POST') {
      if (!session.userId) return jsonResponse({ error: 'Unauthorized.' }, 401);
      const body = await request.json().catch(() => ({}));
      const { itemId } = body;
      if (!itemId) return jsonResponse({ error: 'itemId required.' }, 400);
      try {
        const result = await db.purchaseItem(env, session.userId, itemId);
        return jsonResponse({ message: `${result.item.name} purchased!`, item: result.item });
      } catch (err) {
        return jsonResponse({ error: err.message }, 400);
      }
    }

    // ── Username Check & Featured ──
    if (pathname.startsWith('/api/username/check/')) {
      const u = decodeURIComponent(pathname.replace('/api/username/check/', '')).trim().toLowerCase();
      if (u.length < 1 || u.length > 20 || !/^[a-zA-Z0-9_.-]+$/.test(u)) {
        return jsonResponse({ available: false, error: 'Invalid format.' });
      }
      const user = await db.getUserByUsername(env, u);
      return jsonResponse(user ? { available: false, error: 'Already taken.' } : { available: true });
    }

    if (pathname === '/api/profiles/featured') {
      const all = (await db.getAllProfiles(env)) || [];
      const seed = ['astral','delay','ellie','lunar','lia','saturn'].map(u => ({
        username: u, displayName: u, avatarUrl: '/assets/default_avatar.png', verified: false
      }));
      const list = all.map(p => ({
        username: p.username, displayName: p.display_name || p.username,
        avatarUrl: p.avatar_url || '/assets/default_avatar.png',
        verified: p.badges?.includes('verified')
      }));
      seed.forEach(s => { if (!list.some(p => p.username === s.username)) list.push(s); });
      return jsonResponse(list);
    }

    // ── Admin API Routes ──
    if (pathname.startsWith('/api/admin/')) {
      if (!session.userId) return jsonResponse({ error: 'Unauthorized.' }, 401);
      const user = await db.getUserByUsername(env, session.username);
      if (!user || !['admin','owner'].includes(user.role)) {
        return jsonResponse({ error: 'Forbidden. Admin access required.' }, 403);
      }

      if (pathname === '/api/admin/stats') {
        const stats = await db.getSiteStats(env);
        return jsonResponse(stats);
      }

      if (pathname === '/api/admin/users') {
        const users = await db.getAllUsers(env);
        const mapped = [];
        for (const u of users) {
          const profile = (await db.getProfileByUsername(env, u.username)) || {};
          mapped.push({
            id: u.id, username: u.username, handle: u.handle,
            email: u.email, role: u.role, banned: u.banned || false,
            donated_amount: u.donated_amount || 0,
            created_at: u.created_at,
            views: profile.views || 0
          });
        }
        return jsonResponse(mapped);
      }

      if (pathname.match(/^\/api\/admin\/user\/(\d+)\/role$/) && request.method === 'POST') {
        const id = parseInt(pathname.match(/^\/api\/admin\/user\/(\d+)\/role$/)[1]);
        const { role } = await request.json().catch(() => ({}));
        try {
          const updated = await db.setUserRole(env, id, role);
          return jsonResponse({ message: `Role set to ${role}`, user: updated });
        } catch (err) { return jsonResponse({ error: err.message }, 400); }
      }

      if (pathname.match(/^\/api\/admin\/user\/(\d+)\/ban$/) && request.method === 'POST') {
        const id = parseInt(pathname.match(/^\/api\/admin\/user\/(\d+)\/ban$/)[1]);
        const { banned } = await request.json().catch(() => ({}));
        try {
          const updated = await db.banUser(env, id, banned);
          return jsonResponse({ message: banned ? 'User banned.' : 'User unbanned.', user: updated });
        } catch (err) { return jsonResponse({ error: err.message }, 400); }
      }

      if (pathname.match(/^\/api\/admin\/user\/(\d+)\/donate$/) && request.method === 'POST') {
        const id = parseInt(pathname.match(/^\/api\/admin\/user\/(\d+)\/donate$/)[1]);
        const { amount_cents } = await request.json().catch(() => ({}));
        if (!amount_cents || isNaN(amount_cents)) return jsonResponse({ error: 'amount_cents required.' }, 400);
        try {
          const updated = await db.grantDonation(env, id, parseInt(amount_cents));
          return jsonResponse({ message: `$${(amount_cents/100).toFixed(2)} donated recorded.`, user: updated });
        } catch (err) { return jsonResponse({ error: err.message }, 400); }
      }

      if (pathname.match(/^\/api\/admin\/user\/(\d+)\/grant-item$/) && request.method === 'POST') {
        const id = parseInt(pathname.match(/^\/api\/admin\/user\/(\d+)\/grant-item$/)[1]);
        const { itemId } = await request.json().catch(() => ({}));
        try {
          const updated = await db.grantItem(env, id, itemId);
          return jsonResponse({ message: `Item ${itemId} granted.`, user: updated });
        } catch (err) { return jsonResponse({ error: err.message }, 400); }
      }
    }

    // ════════════════════════════════════════════════════════════════
    //  STATIC PAGES & PROFILE ROUTING
    // ════════════════════════════════════════════════════════════════

    // Map named pages to their HTML file inside public/
    const pageMap = {
      '/login': '/auth.html',
      '/register': '/auth.html',
      '/dashboard': '/dashboard.html',
      '/admin': '/admin.html',
      '/leaderboard': '/leaderboard.html',
      '/shop': '/shop.html',
      '/market': '/market.html',
      '/compare/platforms': '/compare_platforms.html',
      '/donors': '/donors.html',
      '/playground': '/playground.html',
      '/privacy': '/privacy.html',
      '/terms': '/terms.html'
    };

    if (pageMap[pathname]) {
      if (pathname === '/dashboard' && !session.userId) return Response.redirect(`${url.origin}/login`, 302);
      if (pathname === '/admin') {
        if (!session.userId) return Response.redirect(`${url.origin}/login`, 302);
        const u = await db.getUserByUsername(env, session.username);
        if (!u || !['admin','owner'].includes(u.role)) return Response.redirect(`${url.origin}/dashboard`, 302);
      }
      // Serve the mapped asset from Cloudflare Pages static assets
      return await env.ASSETS.fetch(new Request(new URL(pageMap[pathname], request.url), request));
    }

    // First try fetching directly from static assets (CSS, JS, images, index.html)
    const assetRes = await env.ASSETS.fetch(request);
    if (assetRes.status !== 404) {
      return assetRes;
    }

    // Dynamic Username Profile Path Check (/username)
    const SYSTEM = ['login','register','dashboard','leaderboard','api','uploads','assets','css','js',
      'favicon.ico','shop','market','compare','donors','playground','privacy','terms','auth','admin'];
    const sub = pathname.replace(/^\//, '').trim().toLowerCase();
    if (sub && !sub.includes('/') && !SYSTEM.includes(sub)) {
      const profile = await db.getProfileByUsername(env, sub);
      if (profile) {
        return await env.ASSETS.fetch(new Request(new URL('/profile.html', request.url), request));
      }
    }

    // Fallback to index.html for 404 / SPA handling
    return await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
  }
};
