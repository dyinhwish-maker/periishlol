const express = require('express');
const session = require('cookie-session');
const path    = require('path');
const fs      = require('fs');
const https   = require('https');
const multer  = require('multer');
const db      = require('./database');

// ── Load .env ────────────────────────────────────────────────────
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const [k, ...v] = t.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
}

const app  = express();
const PORT = process.env.PORT || 3000;

// Discord OAuth
const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID     || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const DISCORD_REDIRECT_URI  = process.env.DISCORD_REDIRECT_URI  || `http://localhost:${PORT}/auth/discord/callback`;
const DISCORD_SCOPES        = 'identify email';

// Owner username (hardcoded as admin/owner)
const OWNER_USERNAME = (process.env.OWNER_USERNAME || 'tul').toLowerCase();

db.initDb();

// Ensure owner user has owner role on startup
setTimeout(() => {
  try {
    const owner = db.getUserByUsername(OWNER_USERNAME);
    if (owner && owner.role !== 'owner') {
      db.setUserRole(owner.id, 'owner');
      console.log(`[periish.lol] ✓  Set ${OWNER_USERNAME} as owner`);
    }
  } catch(e) { /* owner may not exist yet */ }
}, 100);

// ── Uploads dir ──────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── Session ──────────────────────────────────────────────────────
app.use(session({
  name: 'periish_session',
  keys: [process.env.SESSION_SECRET || 'periish-lol-super-secret-key-1337'],
  maxAge: 7 * 24 * 60 * 60 * 1000
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Multer ───────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => {
    const s = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + s + path.extname(file.originalname));
  }
});
const fileFilter = (req, file, cb) => {
  const ok = ['image/png','image/jpeg','image/jpg','image/gif','image/webp'];
  cb(ok.includes(file.mimetype) ? null : new Error('Invalid file type.'), ok.includes(file.mimetype));
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 8 * 1024 * 1024 } });

// ── Middleware ───────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized.' });
  const user = db.getUserByUsername(req.session.username);
  if (!user || !['admin','owner'].includes(user.role)) {
    return res.status(403).json({ error: 'Forbidden. Admin access required.' });
  }
  next();
}

function requireOwner(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized.' });
  const user = db.getUserByUsername(req.session.username);
  if (!user || user.role !== 'owner') {
    return res.status(403).json({ error: 'Forbidden. Owner access required.' });
  }
  next();
}

// ── HTTPS helpers for Discord ────────────────────────────────────
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const b = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({ hostname, path, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(b) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject); req.write(b); req.end();
  });
}
function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    https.get({ hostname, path, headers }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    }).on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  const user = db.getUserByUsername(req.session.username);
  if (!user || user.banned) { req.session = null; return res.json({ loggedIn: false }); }
  const profile = db.getProfileByUsername(user.username);
  res.json({
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
});

app.post('/api/auth/register', (req, res) => {
  const { username, email, password, handle } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields required.' });
  try {
    const newUser = db.createUser(username, email, password, handle || username);
    if (req.session.pendingDiscord) {
      try { db.linkDiscord(newUser.id, req.session.pendingDiscord); req.session.pendingDiscord = null; } catch {}
    }
    req.session.userId = newUser.id;
    req.session.username = newUser.username;
    res.status(201).json({ message: 'Account created!', username: newUser.username });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/auth/login', (req, res) => {
  const { usernameOrEmail, password } = req.body;
  if (!usernameOrEmail || !password) return res.status(400).json({ error: 'All fields required.' });
  const bcrypt = require('bcryptjs');
  let user = db.getUserByUsername(usernameOrEmail) || db.getUserByEmail(usernameOrEmail);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid credentials.' });
  if (user.banned) return res.status(403).json({ error: 'Account banned.' });
  if (req.session.pendingDiscord && !user.discord_id) {
    try { db.linkDiscord(user.id, req.session.pendingDiscord); req.session.pendingDiscord = null; } catch {}
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ message: 'Logged in!', username: user.username, role: user.role });
});

app.post('/api/auth/logout', (req, res) => {
  req.session = null;
  res.json({ message: 'Logged out.' });
});

// ═══════════════════════════════════════════════════════════════════
//  DISCORD OAUTH
// ═══════════════════════════════════════════════════════════════════

app.get('/api/discord/configured', (req, res) => {
  res.json({ configured: !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET) });
});

app.get('/api/discord/status', requireAuth, (req, res) => {
  const user = db.getUserByUsername(req.session.username);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json(user.discord_id
    ? { linked: true, discord_id: user.discord_id, discord_username: user.discord_username,
        discord_global_name: user.discord_global_name, discord_avatar: user.discord_avatar }
    : { linked: false }
  );
});

app.post('/api/discord/unlink', requireAuth, (req, res) => {
  try { db.unlinkDiscord(req.session.userId); res.json({ message: 'Discord unlinked.' }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/api/discord/pending', (req, res) => {
  if (req.session.pendingDiscord) {
    const d = req.session.pendingDiscord;
    const avatar = d.avatar
      ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/${parseInt(d.id) % 6}.png`;
    res.json({ pending: true, discord_id: d.id, discord_username: d.username,
      discord_global_name: d.global_name, discord_avatar: avatar, email: d.email });
  } else {
    res.json({ pending: false });
  }
});

app.post('/api/discord/pending/clear', (req, res) => {
  req.session.pendingDiscord = null; res.json({ ok: true });
});

app.get('/auth/discord', (req, res) => {
  if (!DISCORD_CLIENT_ID) return res.redirect('/login?error=discord_not_configured');
  req.session.discordOAuthMode = req.query.mode || 'login';
  const params = new URLSearchParams({ client_id: DISCORD_CLIENT_ID, redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code', scope: DISCORD_SCOPES, prompt: 'none' });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/login?error=discord_denied');
  try {
    const tokenData = await httpsPost('discord.com', '/api/oauth2/token',
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code', code, redirect_uri: DISCORD_REDIRECT_URI }).toString()
    );
    if (!tokenData.access_token) return res.redirect('/login?error=discord_token_failed');
    const discordUser = await httpsGet('discord.com', '/api/users/@me',
      { Authorization: `Bearer ${tokenData.access_token}` });
    if (!discordUser?.id) return res.redirect('/login?error=discord_user_failed');

    if (req.session.userId) {
      try { db.linkDiscord(req.session.userId, discordUser); return res.redirect('/dashboard?discord=linked'); }
      catch (err) { return res.redirect('/dashboard?error=' + encodeURIComponent(err.message)); }
    }

    const existingUser = db.getUserByDiscordId(discordUser.id);
    if (existingUser) {
      req.session.userId = existingUser.id; req.session.username = existingUser.username;
      return res.redirect('/dashboard?discord=linked');
    }

    req.session.pendingDiscord = { id: discordUser.id, username: discordUser.username,
      global_name: discordUser.global_name || discordUser.username,
      avatar: discordUser.avatar, email: discordUser.email || null };

    const mode = req.session.discordOAuthMode || 'login';
    return res.redirect(mode === 'register' ? '/register?discord=connected' : '/login?discord=connected');
  } catch (err) {
    console.error('Discord OAuth error:', err);
    return res.redirect('/login?error=discord_error');
  }
});

// ═══════════════════════════════════════════════════════════════════
//  PROFILE ROUTES
// ═══════════════════════════════════════════════════════════════════

app.get('/api/profile/public/:username', (req, res) => {
  const profile = db.getProfileByUsername(req.params.username);
  if (!profile) return res.status(404).json({ error: 'Profile not found.' });
  const views = db.incrementProfileViews(req.params.username);
  profile.views = views;
  res.json(profile);
});

app.post('/api/profile/save', requireAuth, (req, res) => {
  try {
    const profile = db.saveProfile(req.session.userId, req.body);
    res.json({ message: 'Profile saved!', profile });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/profile/upload', requireAuth, upload.single('mediaFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file or invalid type.' });
  res.json({ fileUrl: '/uploads/' + req.file.filename });
});

// ═══════════════════════════════════════════════════════════════════
//  LEADERBOARD ROUTES
// ═══════════════════════════════════════════════════════════════════

app.get('/api/leaderboard', (req, res) => {
  const profiles = db.getAllProfiles().sort((a, b) => b.views - a.views);
  res.json(profiles);
});

app.get('/api/leaderboard/donors', (req, res) => {
  res.json(db.getTopDonors(100));
});

// ═══════════════════════════════════════════════════════════════════
//  STORE ROUTES
// ═══════════════════════════════════════════════════════════════════

app.get('/api/store/items', (req, res) => {
  const items = db.getStoreItems();
  if (req.session.userId) {
    const user = db.getUserByUsername(req.session.username);
    const owned = user?.store_purchases || [];
    return res.json(items.map(i => ({ ...i, owned: owned.includes(i.id) })));
  }
  res.json(items);
});

app.post('/api/store/purchase', requireAuth, (req, res) => {
  const { itemId } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId required.' });
  try {
    const result = db.purchaseItem(req.session.userId, itemId);
    res.json({ message: `${result.item.name} purchased!`, item: result.item });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════
//  USERNAME CHECK
// ═══════════════════════════════════════════════════════════════════

app.get('/api/username/check/:username', (req, res) => {
  const u = req.params.username.trim().toLowerCase();
  if (u.length < 1 || u.length > 20 || !/^[a-zA-Z0-9_.-]+$/.test(u))
    return res.json({ available: false, error: 'Invalid format.' });
  const user = db.getUserByUsername(u);
  res.json(user ? { available: false, error: 'Already taken.' } : { available: true });
});

// ═══════════════════════════════════════════════════════════════════
//  FEATURED PROFILES
// ═══════════════════════════════════════════════════════════════════

app.get('/api/profiles/featured', (req, res) => {
  const all = db.getAllProfiles() || [];
  const seed = ['astral','delay','ellie','lunar','lia','saturn'].map(u => ({
    username: u, displayName: u, avatarUrl: '/assets/default_avatar.png', verified: false
  }));
  const list = all.map(p => ({
    username: p.username, displayName: p.display_name || p.username,
    avatarUrl: p.avatar_url || '/assets/default_avatar.png',
    verified: p.badges?.includes('verified')
  }));
  seed.forEach(s => { if (!list.some(p => p.username === s.username)) list.push(s); });
  res.json(list);
});

// ═══════════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  res.json(db.getSiteStats());
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.getAllUsers().map(u => ({
    id: u.id, username: u.username, handle: u.handle,
    email: u.email, role: u.role, banned: u.banned || false,
    donated_amount: u.donated_amount || 0,
    created_at: u.created_at,
    views: (db.getProfileByUsername(u.username) || {}).views || 0
  }));
  res.json(users);
});

app.post('/api/admin/user/:id/role', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { role } = req.body;
  try {
    const user = db.setUserRole(id, role);
    res.json({ message: `Role set to ${role}`, user });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/admin/user/:id/ban', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { banned } = req.body;
  try {
    const user = db.banUser(id, banned);
    res.json({ message: banned ? 'User banned.' : 'User unbanned.', user });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/admin/user/:id/donate', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { amount_cents } = req.body;
  if (!amount_cents || isNaN(amount_cents)) return res.status(400).json({ error: 'amount_cents required.' });
  try {
    const user = db.grantDonation(id, parseInt(amount_cents));
    res.json({ message: `$${(amount_cents/100).toFixed(2)} donated recorded.`, user });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/admin/user/:id/grant-item', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { itemId } = req.body;
  try {
    const user = db.grantItem(id, itemId);
    res.json({ message: `Item ${itemId} granted.`, user });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════
//  STATIC + PAGE ROUTES
// ═══════════════════════════════════════════════════════════════════

app.use(express.static(path.join(__dirname, '..', 'public')));

const sendPage = f => (req, res) => res.sendFile(path.join(__dirname, '..', 'public', f));

app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/login',    sendPage('auth.html'));
app.get('/register', sendPage('auth.html'));

app.get('/dashboard', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  sendPage('dashboard.html')(req, res);
});

app.get('/admin', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const user = db.getUserByUsername(req.session.username);
  if (!user || !['admin','owner'].includes(user.role)) return res.redirect('/dashboard');
  sendPage('admin.html')(req, res);
});

app.get('/leaderboard',       sendPage('leaderboard.html'));
app.get('/shop',              sendPage('shop.html'));
app.get('/market',            sendPage('market.html'));
app.get('/compare/platforms', sendPage('compare_platforms.html'));
app.get('/donors',            sendPage('donors.html'));
app.get('/playground',        sendPage('playground.html'));
app.get('/privacy',           sendPage('privacy.html'));
app.get('/terms',             sendPage('terms.html'));

// Dynamic username subpath
const SYSTEM = ['login','register','dashboard','leaderboard','api','uploads','assets','css','js',
  'favicon.ico','shop','market','compare','donors','playground','privacy','terms','auth','admin'];

app.get('/:username', (req, res, next) => {
  const u = req.params.username.trim().toLowerCase();
  if (SYSTEM.includes(u)) return next();
  const profile = db.getProfileByUsername(u);
  profile ? res.sendFile(path.join(__dirname, '..', 'public', 'profile.html'))
          : res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[periish.lol] Server running at http://localhost:${PORT}`);
  console.log(`[periish.lol] Owner: ${OWNER_USERNAME}`);
  if (!DISCORD_CLIENT_ID) console.log(`[periish.lol] ⚠  Discord OAuth not configured`);
});
