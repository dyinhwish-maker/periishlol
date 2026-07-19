// database.js — Adapted for Cloudflare Workers (env.DB KV storage) + local Node fallback
const bcrypt = require('bcryptjs');

// ── Read / Write (Async with Cloudflare KV env.DB) ────────────────
async function readData(env) {
  if (env && env.DB) {
    try {
      const raw = await env.DB.get('periish_db', { type: 'json' });
      if (raw) return raw;
    } catch (err) {
      console.error('KV read error:', err);
    }
  }
  // Fallback if no KV / local testing
  return { users: [], profiles: {} };
}

async function writeData(env, data) {
  if (env && env.DB) {
    try {
      await env.DB.put('periish_db', JSON.stringify(data));
    } catch (err) {
      console.error('KV write error:', err);
    }
  }
}

// ── Migrate existing user fields ──────────────────────────────────
function migrateUser(user) {
  const defaults = {
    handle: user.username,
    role: 'user',                  // 'user' | 'premium' | 'admin' | 'owner'
    donated_amount: 0,             // in USD cents
    store_purchases: [],           // array of item IDs
    discord_id: null,
    discord_username: null,
    discord_global_name: null,
    discord_avatar: null,
    banned: false,
    created_at: user.created_at || new Date().toISOString()
  };
  return { ...defaults, ...user };
}

// ── Create User ───────────────────────────────────────────────────
async function createUser(env, username, email, password, handle) {
  const db = await readData(env);

  const cleanUsername = username.trim().toLowerCase();
  if (cleanUsername.length < 1 || cleanUsername.length > 20 || !/^[a-zA-Z0-9_.-]+$/.test(cleanUsername)) {
    throw new Error('Invalid username. Must be 1-20 chars: letters, numbers, _ . -');
  }

  const emailLower = email.trim().toLowerCase();
  if (db.users.some(u => u.username === cleanUsername || u.email === emailLower)) {
    throw new Error('Username or Email already claimed.');
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const userId = db.users.length > 0 ? Math.max(...db.users.map(u => u.id)) + 1 : 1;
  const cleanHandle = handle ? handle.trim().replace(/^@/, '') : cleanUsername;

  const newUser = {
    id: userId,
    username: cleanUsername,
    handle: cleanHandle,
    email: emailLower,
    password_hash: passwordHash,
    role: 'user',
    donated_amount: 0,
    store_purchases: [],
    discord_id: null,
    discord_username: null,
    discord_global_name: null,
    discord_avatar: null,
    banned: false,
    created_at: new Date().toISOString()
  };

  db.users.push(newUser);

  // Default profile
  db.profiles[cleanUsername] = {
    user_id: userId,
    display_name: handle || username,
    bio: 'This is your customizable bio page.',
    avatar_url: '/assets/default_avatar.png',
    background_url: '',
    background_type: 'color',
    music_url: '',
    layout_type: 'card',
    tilt_effect: false,
    universal_theme: 'subtle-white',
    colors: {
      bg_color: '#080808',
      card_bg: 'rgba(18, 18, 18, 0.7)',
      border_color: 'rgba(255, 255, 255, 0.05)',
      text_color: '#ffffff',
      text_muted: '#8a8a8a',
      accent_color: '#35fe7e'
    },
    widgets: [
      { id: 'w_profile', type: 'profile', x: 0, y: 0, w: 6, h: 2, title: 'Profile info', content: '' },
      { id: 'w_links',   type: 'links',   x: 0, y: 2, w: 6, h: 2, title: 'Socials',
        links: [{ label: 'Discord', url: 'https://discord.gg/periish' }] }
    ],
    badges: ['early_access'],
    views: 0,
    custom_css: '',
    seo_title: '',
    seo_description: '',
    font_family: 'Outfit',
    overlay_effect: '',
    glow_intensity: 1
  };

  await writeData(env, db);
  return newUser;
}

// ── Lookup helpers ────────────────────────────────────────────────
async function getUserByUsername(env, username) {
  const db = await readData(env);
  const u = username.trim().toLowerCase();
  const user = db.users.find(x => x.username === u) || null;
  return user ? migrateUser(user) : null;
}

async function getUserByEmail(env, email) {
  const db = await readData(env);
  const e = email.trim().toLowerCase();
  const user = db.users.find(x => x.email === e) || null;
  return user ? migrateUser(user) : null;
}

async function getUserById(env, id) {
  const db = await readData(env);
  const user = db.users.find(x => x.id === id) || null;
  return user ? migrateUser(user) : null;
}

async function getUserByDiscordId(env, discordId) {
  const db = await readData(env);
  const user = db.users.find(x => x.discord_id === discordId) || null;
  return user ? migrateUser(user) : null;
}

async function getAllUsers(env) {
  const db = await readData(env);
  return db.users.map(migrateUser);
}

// ── Role management ───────────────────────────────────────────────
async function setUserRole(env, userId, role) {
  const valid = ['user', 'premium', 'admin', 'owner'];
  if (!valid.includes(role)) throw new Error('Invalid role.');
  const db = await readData(env);
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('User not found.');
  user.role = role;
  await writeData(env, db);
  return migrateUser(user);
}

async function banUser(env, userId, banned) {
  const db = await readData(env);
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('User not found.');
  user.banned = !!banned;
  await writeData(env, db);
  return migrateUser(user);
}

// ── Discord ───────────────────────────────────────────────────────
async function linkDiscord(env, userId, discordData) {
  const db = await readData(env);
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('User not found.');
  const existing = db.users.find(u => u.discord_id === discordData.id && u.id !== userId);
  if (existing) throw new Error('This Discord account is already linked to another periish account.');

  user.discord_id = discordData.id;
  user.discord_username = discordData.username;
  user.discord_global_name = discordData.global_name || discordData.username;
  user.discord_avatar = discordData.avatar
    ? `https://cdn.discordapp.com/avatars/${discordData.id}/${discordData.avatar}.png`
    : `https://cdn.discordapp.com/embed/avatars/${parseInt(discordData.id) % 6}.png`;

  await writeData(env, db);
  return migrateUser(user);
}

async function unlinkDiscord(env, userId) {
  const db = await readData(env);
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('User not found.');
  user.discord_id = null; user.discord_username = null;
  user.discord_global_name = null; user.discord_avatar = null;
  await writeData(env, db);
  return migrateUser(user);
}

// ── Donations ─────────────────────────────────────────────────────
async function grantDonation(env, userId, amountCents) {
  const db = await readData(env);
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('User not found.');
  if (!user.donated_amount) user.donated_amount = 0;
  user.donated_amount += amountCents;

  if (db.profiles[user.username]) {
    const badges = db.profiles[user.username].badges || [];
    if (!badges.includes('donor')) {
      db.profiles[user.username].badges = [...badges, 'donor'];
    }
  }

  await writeData(env, db);
  return migrateUser(user);
}

async function getTopDonors(env, limit = 50) {
  const db = await readData(env);
  return db.users
    .map(migrateUser)
    .filter(u => u.donated_amount > 0)
    .sort((a, b) => b.donated_amount - a.donated_amount)
    .slice(0, limit)
    .map(u => ({
      id: u.id,
      username: u.username,
      handle: u.handle || u.username,
      donated_amount: u.donated_amount,
      avatar_url: (db.profiles[u.username] || {}).avatar_url || '/assets/default_avatar.png',
      display_name: (db.profiles[u.username] || {}).display_name || u.username,
      badges: (db.profiles[u.username] || {}).badges || []
    }));
}

// ── Store ─────────────────────────────────────────────────────────
const STORE_ITEMS = [
  { id: 'badge_early_access', name: 'Early Access', category: 'badge', price: 0, description: 'Granted to early members', color: '#35fe7e', icon: '⚡', rarity: 'common' },
  { id: 'badge_verified',     name: 'Verified',     category: 'badge', price: 0, description: 'Admin-granted verification', color: '#35fe7e', icon: '✓', rarity: 'rare', admin_only: true },
  { id: 'badge_donor',        name: 'Donor',        category: 'badge', price: 0, description: 'Given to site supporters', color: '#ffd700', icon: '💛', rarity: 'uncommon', donation_gated: true },
  { id: 'badge_og',           name: 'OG',           category: 'badge', price: 999, description: 'Original gangster status', color: '#f87171', icon: '👑', rarity: 'legendary' },
  { id: 'badge_phantom',      name: 'Phantom',      category: 'badge', price: 499, description: 'Ghost in the machine', color: '#a78bfa', icon: '👻', rarity: 'epic' },
  { id: 'badge_neon',         name: 'Neon',         category: 'badge', price: 299, description: 'Glowing in the dark', color: '#fb923c', icon: '🌟', rarity: 'rare' },
  { id: 'effect_cyberpunk',   name: 'Cyberpunk Overlay', category: 'effect', price: 199, description: 'Cyberpunk grid overlay', rarity: 'uncommon', preview: '/assets/overlays_cyberpunk.gif' },
  { id: 'effect_rain',        name: 'Rain Overlay',      category: 'effect', price: 99,  description: 'Atmospheric rain effect', rarity: 'common',   preview: '/assets/overlays_rain.gif' },
  { id: 'effect_glitch',      name: 'Glitch Overlay',    category: 'effect', price: 249, description: 'Digital glitch aesthetic', rarity: 'rare',    preview: '/assets/overlays_glitch.gif' },
  { id: 'effect_stars',       name: 'Shooting Stars',    category: 'effect', price: 399, description: 'Shooting star particle field', rarity: 'epic', preview: '/assets/overlays_shooting-stars.gif' },
  { id: 'font_unbounded',     name: 'Unbounded Font',    category: 'font', price: 0, description: 'Bold geometric display font', rarity: 'common' },
  { id: 'font_mono',          name: 'JetBrains Mono',    category: 'font', price: 149, description: 'Premium monospace font', rarity: 'uncommon' },
  { id: 'plan_pro',           name: 'Pro Plan',           category: 'plan', price: 499, description: 'Custom CSS, analytics, priority support', rarity: 'uncommon', monthly: true },
  { id: 'plan_elite',         name: 'Elite Plan',         category: 'plan', price: 999, description: 'Custom domain, all effects, badge priority', rarity: 'legendary', monthly: true },
];

function getStoreItems() { return STORE_ITEMS; }

async function purchaseItem(env, userId, itemId) {
  const db = await readData(env);
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('User not found.');

  const item = STORE_ITEMS.find(i => i.id === itemId);
  if (!item) throw new Error('Item not found.');
  if (item.admin_only) throw new Error('This item can only be granted by admins.');

  if (!user.store_purchases) user.store_purchases = [];
  if (user.store_purchases.includes(itemId)) throw new Error('You already own this item.');

  user.store_purchases.push(itemId);

  if (item.category === 'badge' && db.profiles[user.username]) {
    const badgeName = item.id.replace('badge_', '');
    const badges = db.profiles[user.username].badges || [];
    if (!badges.includes(badgeName)) {
      db.profiles[user.username].badges = [...badges, badgeName];
    }
  }

  await writeData(env, db);
  return { user: migrateUser(user), item };
}

async function grantItem(env, userId, itemId) {
  const db = await readData(env);
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('User not found.');
  if (!user.store_purchases) user.store_purchases = [];
  if (!user.store_purchases.includes(itemId)) {
    user.store_purchases.push(itemId);
  }
  await writeData(env, db);
  return migrateUser(user);
}

// ── Profile ───────────────────────────────────────────────────────
async function getProfileByUsername(env, username) {
  const db = await readData(env);
  return db.profiles[username.trim().toLowerCase()] || null;
}

async function saveProfile(env, userId, profileData) {
  const db = await readData(env);
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('User not found.');
  const profile = db.profiles[user.username];
  if (!profile) throw new Error('Profile not initialized.');

  const allowed = [
    'display_name','bio','avatar_url','background_url','background_type',
    'music_url','layout_type','tilt_effect','universal_theme','colors',
    'widgets','badges','custom_css','seo_title','seo_description',
    'font_family','overlay_effect','glow_intensity'
  ];

  allowed.forEach(key => {
    if (profileData[key] !== undefined) {
      if (key === 'colors') {
        profile.colors = { ...profile.colors, ...profileData.colors };
      } else if (key === 'tilt_effect') {
        profile.tilt_effect = !!profileData.tilt_effect;
      } else {
        profile[key] = profileData[key];
      }
    }
  });

  await writeData(env, db);
  return profile;
}

async function incrementProfileViews(env, username) {
  const db = await readData(env);
  const u = username.trim().toLowerCase();
  if (db.profiles[u]) {
    db.profiles[u].views = (db.profiles[u].views || 0) + 1;
    await writeData(env, db);
    return db.profiles[u].views;
  }
  return 0;
}

async function getAllProfiles(env) {
  const db = await readData(env);
  return Object.keys(db.profiles).map(username => ({
    username,
    display_name: db.profiles[username].display_name,
    avatar_url:   db.profiles[username].avatar_url,
    views:        db.profiles[username].views || 0,
    badges:       db.profiles[username].badges || []
  }));
}

// ── Site Stats (admin) ────────────────────────────────────────────
async function getSiteStats(env) {
  const db = await readData(env);
  const totalUsers    = db.users.length;
  const totalViews    = Object.values(db.profiles).reduce((s, p) => s + (p.views || 0), 0);
  const totalDonated  = db.users.reduce((s, u) => s + (u.donated_amount || 0), 0);
  const premiumUsers  = db.users.filter(u => u.role === 'premium' || u.role === 'admin' || u.role === 'owner').length;
  return { totalUsers, totalViews, totalDonated, premiumUsers };
}

module.exports = {
  readData, writeData,
  createUser, getAllUsers,
  getUserByUsername, getUserByEmail, getUserById, getUserByDiscordId,
  setUserRole, banUser,
  linkDiscord, unlinkDiscord,
  grantDonation, getTopDonors,
  getStoreItems, purchaseItem, grantItem,
  getProfileByUsername, saveProfile, incrementProfileViews, getAllProfiles,
  getSiteStats
};
