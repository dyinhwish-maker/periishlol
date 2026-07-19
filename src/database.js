const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_FILE = path.join(__dirname, '..', 'periish_db.json');

// ── Initialize DB ────────────────────────────────────────────────
function initDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], profiles: {} }, null, 2), 'utf8');
  }
}

// ── Read / Write ─────────────────────────────────────────────────
function readData() {
  initDb();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    console.error('DB read error, resetting:', err);
    return { users: [], profiles: {} };
  }
}

function writeData(data) {
  try {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error('DB write error:', err);
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
function createUser(username, email, password, handle) {
  const db = readData();

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

  writeData(db);
  return newUser;
}

// ── Lookup helpers ────────────────────────────────────────────────
function getUserByUsername(username) {
  const db = readData();
  const u = username.trim().toLowerCase();
  const user = db.users.find(x => x.username === u) || null;
  return user ? migrateUser(user) : null;
}

function getUserByEmail(email) {
  const db = readData();
  const e = email.trim().toLowerCase();
  const user = db.users.find(x => x.email === e) || null;
  return user ? migrateUser(user) : null;
}

function getUserById(id) {
  const db = readData();
  const user = db.users.find(x => x.id === id) || null;
  return user ? migrateUser(user) : null;
}

function getUserByDiscordId(discordId) {
  const db = readData();
  const user = db.users.find(x => x.discord_id === discordId) || null;
  return user ? migrateUser(user) : null;
}

function getAllUsers() {
  const db = readData();
  return db.users.map(migrateUser);
}

// ── Role management ───────────────────────────────────────────────
function setUserRole(userId, role) {
  const valid = ['user', 'premium', 'admin', 'owner'];
  if (!valid.includes(role)) throw new Error('Invalid role.');
  const db = readData();
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('User not found.');
  user.role = role;
  writeData(db);
  return migrateUser(user);
}

function banUser(userId, banned) {
  const db = readData();
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('User not found.');
  user.banned = !!banned;
  writeData(db);
  return migrateUser(user);
}

// ── Discord ───────────────────────────────────────────────────────
function linkDiscord(userId, discordData) {
  const db = readData();
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

  writeData(db);
  return migrateUser(user);
}

function unlinkDiscord(userId) {
  const db = readData();
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('User not found.');
  user.discord_id = null; user.discord_username = null;
  user.discord_global_name = null; user.discord_avatar = null;
  writeData(db);
  return migrateUser(user);
}

// ── Donations ─────────────────────────────────────────────────────
function grantDonation(userId, amountCents) {
  const db = readData();
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('User not found.');
  if (!user.donated_amount) user.donated_amount = 0;
  user.donated_amount += amountCents;

  // Auto-grant donor badge to profile
  if (db.profiles[user.username]) {
    const badges = db.profiles[user.username].badges || [];
    if (!badges.includes('donor')) {
      db.profiles[user.username].badges = [...badges, 'donor'];
    }
  }

  writeData(db);
  return migrateUser(user);
}

function getTopDonors(limit = 50) {
  const db = readData();
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

function purchaseItem(userId, itemId) {
  const db = readData();
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('User not found.');

  const item = STORE_ITEMS.find(i => i.id === itemId);
  if (!item) throw new Error('Item not found.');
  if (item.admin_only) throw new Error('This item can only be granted by admins.');

  if (!user.store_purchases) user.store_purchases = [];
  if (user.store_purchases.includes(itemId)) throw new Error('You already own this item.');

  user.store_purchases.push(itemId);

  // Auto-apply badge purchases to profile
  if (item.category === 'badge' && db.profiles[user.username]) {
    const badgeName = item.id.replace('badge_', '');
    const badges = db.profiles[user.username].badges || [];
    if (!badges.includes(badgeName)) {
      db.profiles[user.username].badges = [...badges, badgeName];
    }
  }

  writeData(db);
  return { user: migrateUser(user), item };
}

function grantItem(userId, itemId) {
  const db = readData();
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('User not found.');
  if (!user.store_purchases) user.store_purchases = [];
  if (!user.store_purchases.includes(itemId)) {
    user.store_purchases.push(itemId);
  }
  writeData(db);
  return migrateUser(user);
}

// ── Profile ───────────────────────────────────────────────────────
function getProfileByUsername(username) {
  const db = readData();
  return db.profiles[username.trim().toLowerCase()] || null;
}

function saveProfile(userId, profileData) {
  const db = readData();
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

  writeData(db);
  return profile;
}

function incrementProfileViews(username) {
  const db = readData();
  const u = username.trim().toLowerCase();
  if (db.profiles[u]) {
    db.profiles[u].views = (db.profiles[u].views || 0) + 1;
    writeData(db);
    return db.profiles[u].views;
  }
  return 0;
}

function getAllProfiles() {
  const db = readData();
  return Object.keys(db.profiles).map(username => ({
    username,
    display_name: db.profiles[username].display_name,
    avatar_url:   db.profiles[username].avatar_url,
    views:        db.profiles[username].views || 0,
    badges:       db.profiles[username].badges || []
  }));
}

// ── Site Stats (admin) ────────────────────────────────────────────
function getSiteStats() {
  const db = readData();
  const totalUsers    = db.users.length;
  const totalViews    = Object.values(db.profiles).reduce((s, p) => s + (p.views || 0), 0);
  const totalDonated  = db.users.reduce((s, u) => s + (u.donated_amount || 0), 0);
  const premiumUsers  = db.users.filter(u => u.role === 'premium' || u.role === 'admin' || u.role === 'owner').length;
  return { totalUsers, totalViews, totalDonated, premiumUsers };
}

module.exports = {
  initDb, readData, writeData,
  createUser, getAllUsers,
  getUserByUsername, getUserByEmail, getUserById, getUserByDiscordId,
  setUserRole, banUser,
  linkDiscord, unlinkDiscord,
  grantDonation, getTopDonors,
  getStoreItems, purchaseItem, grantItem,
  getProfileByUsername, saveProfile, incrementProfileViews, getAllProfiles,
  getSiteStats
};
