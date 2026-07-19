// periish.lol — Dashboard Controller
'use strict';

let profile = null;
let currentUser = null;

// ── DOM refs ──────────────────────────────────────────────────────
const previewFrame  = document.getElementById('preview-frame');
const previewLink   = document.getElementById('preview-link');
const avatarPreview = document.getElementById('avatar-preview');
const displayNameInput = document.getElementById('profile-display-name');
const bioInput         = document.getElementById('profile-bio');
const themeSelect      = document.getElementById('theme-select');
const customThemeGroup = document.getElementById('custom-theme-color-group');
const customThemeColor = document.getElementById('custom-theme-color');
const customThemeHex   = document.getElementById('custom-theme-color-hex');
const bgTypeSelect     = document.getElementById('bg-type-select');
const bgUploadGroup    = document.getElementById('bg-upload-group');
const bgFileName       = document.getElementById('bg-file-name');
const musicUrlInput    = document.getElementById('music-url');
const fontSelect       = document.getElementById('font-select');
const widgetModal      = document.getElementById('widget-modal');
const widgetTypeSelect = document.getElementById('widget-type-select');
const widgetTitleInput = document.getElementById('widget-title');
const linksEditorList  = document.getElementById('links-editor-list');
const configLinks      = document.getElementById('config-links');
const configText       = document.getElementById('config-text');
const configSpotify    = document.getElementById('config-spotify');

const colorInputs = {
  bg_color:     document.getElementById('col-bg'),
  card_bg:      document.getElementById('col-card'),
  border_color: document.getElementById('col-border'),
  text_color:   document.getElementById('col-text'),
  text_muted:   document.getElementById('col-text-muted'),
  accent_color: document.getElementById('col-accent')
};

let currentEditingWidgetIndex = null;

// ── Init ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadUserData();
  setupSidebarNav();
  setupEventListeners();

  // Toast from URL params
  const params = new URLSearchParams(window.location.search);
  if (params.get('discord') === 'linked') {
    setTimeout(() => showToast('Discord account linked! ✓'), 800);
    history.replaceState({}, '', '/dashboard');
  }
  if (params.get('error')) {
    setTimeout(() => showToast(decodeURIComponent(params.get('error')), true), 800);
    history.replaceState({}, '', '/dashboard');
  }
});

// ── Load user data ────────────────────────────────────────────────
function loadUserData() {
  fetch('/api/auth/me')
    .then(r => r.json())
    .then(data => {
      if (!data.loggedIn) { window.location.href = '/login'; return; }

      currentUser = data.user;
      profile = data.profile;

      // Sidebar chip
      document.getElementById('sidebar-avatar').src = profile.avatar_url || '/assets/default_avatar.png';
      document.getElementById('sidebar-name').textContent = profile.display_name || currentUser.username;
      document.getElementById('sidebar-handle').textContent = '@' + (currentUser.handle || currentUser.username);

      // Show admin nav if applicable
      if (['admin','owner'].includes(currentUser.role)) {
        document.getElementById('admin-nav-item').style.display = 'block';
      }

      // Overview tab
      document.getElementById('ov-avatar').src = profile.avatar_url || '/assets/default_avatar.png';
      document.getElementById('ov-name').textContent = profile.display_name || currentUser.username;
      document.getElementById('ov-handle').textContent = '@' + (currentUser.handle || currentUser.username);
      const pLink = `/${currentUser.username}`;
      document.getElementById('ov-link').href = pLink;
      document.getElementById('ov-link').textContent = 'periish.lol' + pLink + ' →';

      // Stats
      document.getElementById('stat-views').textContent = (profile.views || 0).toLocaleString();
      document.getElementById('stat-widgets').textContent = (profile.widgets || []).length;
      document.getElementById('stat-badges').textContent = (profile.badges || []).length;
      document.getElementById('an-views').textContent = (profile.views || 0).toLocaleString();

      // Edit tab
      avatarPreview.src = profile.avatar_url || '/assets/default_avatar.png';
      displayNameInput.value = profile.display_name || '';
      bioInput.value = profile.bio || '';
      document.getElementById('seo-title').value = profile.seo_title || '';
      document.getElementById('seo-description').value = profile.seo_description || '';

      // Style tab
      const theme = profile.universal_theme || 'subtle-white';
      themeSelect.value = theme.startsWith('#') ? 'custom' : theme;
      document.getElementById('tilt-effect-checkbox').checked = !!profile.tilt_effect;
      document.getElementById('verified-badge-checkbox').checked = (profile.badges || []).includes('verified');
      if (theme.startsWith('#')) {
        customThemeGroup.style.display = 'block';
        customThemeColor.value = theme;
        customThemeHex.value = theme;
      }

      bgTypeSelect.value = profile.background_type || 'color';
      if (profile.background_type === 'image') {
        bgUploadGroup.style.display = 'block';
        bgFileName.textContent = profile.background_url ? profile.background_url.split('/').pop() : 'No file';
      }

      musicUrlInput.value = profile.music_url || '';
      fontSelect.value = profile.font_family || 'Outfit';

      // Colors
      Object.keys(colorInputs).forEach(key => {
        if (profile.colors?.[key]) {
          const val = profile.colors[key];
          colorInputs[key].value = val.startsWith('rgba') ? rgbaToHex(val) : val;
        }
      });

      // Overlay
      document.querySelectorAll('.overlay-option').forEach(opt => {
        const ov = opt.dataset.overlay || '';
        opt.classList.toggle('active', ov === (profile.overlay_effect || ''));
      });

      // Layout
      document.querySelectorAll('.layout-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.layout === profile.layout_type);
      });

      // Widgets
      renderWidgetsList();

      // Preview
      previewLink.href = `/${currentUser.username}`;
      previewLink.textContent = `periish.lol/${currentUser.username}`;
      reloadPreview();

      // Discord status
      loadDiscordStatus(currentUser);

      // Badges tab
      renderOwnedBadges();

      // Settings tab
      document.getElementById('set-username').textContent = currentUser.username;
      document.getElementById('set-handle').textContent = '@' + (currentUser.handle || currentUser.username);
      document.getElementById('set-email').textContent = currentUser.email || '—';
      const roleEl = document.getElementById('set-role');
      roleEl.innerHTML = `<span class="role-tag role-${currentUser.role}">${currentUser.role}</span>`;

      // Analytics leaderboard rank
      loadLeaderboardRank();
    })
    .catch(() => window.location.href = '/login');
}

async function loadLeaderboardRank() {
  try {
    const r = await fetch('/api/leaderboard');
    const data = await r.json();
    const rank = data.findIndex(p => p.username === currentUser.username) + 1;
    document.getElementById('an-rank').textContent = rank > 0 ? `#${rank}` : '—';
    document.getElementById('lb-position-display').innerHTML = rank > 0
      ? `You are ranked <strong>#${rank}</strong> out of ${data.length} profiles.`
      : 'Your profile has not appeared on the leaderboard yet. Get more views!';
  } catch { /* ignore */ }
}

// ── Discord section ───────────────────────────────────────────────
function loadDiscordStatus(user) {
  const linked   = document.getElementById('discord-linked-card');
  const unlinked = document.getElementById('discord-unlinked-card');
  if (!linked || !unlinked) return;
  if (user.discord_id) {
    document.getElementById('discord-linked-avatar').src = user.discord_avatar || `https://cdn.discordapp.com/embed/avatars/0.png`;
    document.getElementById('discord-linked-name').textContent = user.discord_global_name || user.discord_username || 'Discord User';
    linked.style.display = 'flex';
    unlinked.style.display = 'none';
  } else {
    linked.style.display = 'none';
    unlinked.style.display = 'flex';
  }
}

// ── Owned badges ──────────────────────────────────────────────────
function renderOwnedBadges() {
  const grid = document.getElementById('owned-badges-grid');
  const badges = profile.badges || [];
  if (badges.length === 0) {
    grid.innerHTML = '<div style="color:#444;font-size:13px;grid-column:1/-1;">No badges yet. Visit the shop to get some!</div>';
    return;
  }
  const icons = { verified:'✓', donor:'💛', early_access:'⚡', og:'👑', phantom:'👻', neon:'🌟', admin:'🛡' };
  grid.innerHTML = badges.map(b => `
    <div class="owned-badge-card">
      <div class="owned-badge-icon">${icons[b] || '🏅'}</div>
      <div class="owned-badge-name">${b.replace('_',' ')}</div>
    </div>
  `).join('');
}

// ── Overlay effect picker ─────────────────────────────────────────
window.setOverlay = function(el, overlay) {
  document.querySelectorAll('.overlay-option').forEach(o => o.classList.remove('active'));
  el.classList.add('active');
  if (profile) profile.overlay_effect = overlay;
};

// ── Sidebar navigation ────────────────────────────────────────────
const TAB_NAMES = {
  overview: 'Overview', edit: 'Edit Profile', widgets: 'Links & Widgets',
  style: 'Style & Theme', analytics: 'Analytics', store: 'My Badges', settings: 'Settings'
};

function setupSidebarNav() {
  document.querySelectorAll('.sidebar-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    document.getElementById('dash-sidebar').classList.toggle('open');
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item[data-tab]').forEach(b => b.classList.remove('active'));

  const panel = document.getElementById(`tab-${name}`);
  if (panel) panel.classList.add('active');
  document.querySelector(`.sidebar-item[data-tab="${name}"]`)?.classList.add('active');
  document.getElementById('dash-page-title').textContent = TAB_NAMES[name] || name;

  // Close mobile sidebar
  document.getElementById('dash-sidebar').classList.remove('open');
}

// Global for leaderboard.html to call
window.switchTab = switchTab;

// ── Event listeners ───────────────────────────────────────────────
function setupEventListeners() {
  // Save
  document.getElementById('save-btn').addEventListener('click', saveProfileData);

  // Logout
  document.getElementById('logout-btn').addEventListener('click', confirmLogout);

  // Avatar upload
  document.getElementById('avatar-upload').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData(); fd.append('mediaFile', file);
    fetch('/api/profile/upload', { method: 'POST', body: fd })
      .then(r => r.json())
      .then(d => {
        if (d.fileUrl) { profile.avatar_url = d.fileUrl; avatarPreview.src = d.fileUrl; showToast('Avatar uploaded!'); reloadPreview(); }
        else showToast(d.error || 'Upload failed.', true);
      });
  });

  // BG upload
  document.getElementById('bg-upload').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('mediaFile', file);
    fetch('/api/profile/upload', { method: 'POST', body: fd })
      .then(r => r.json())
      .then(d => {
        if (d.fileUrl) { profile.background_url = d.fileUrl; bgFileName.textContent = d.fileUrl.split('/').pop(); showToast('Background uploaded!'); reloadPreview(); }
        else showToast(d.error || 'Upload failed.', true);
      });
  });

  // Theme
  themeSelect.addEventListener('change', e => {
    const val = e.target.value;
    customThemeGroup.style.display = val === 'custom' ? 'block' : 'none';
    if (profile) profile.universal_theme = val === 'custom' ? customThemeColor.value : val;
  });
  customThemeColor.addEventListener('input', e => { customThemeHex.value = e.target.value; if (profile) profile.universal_theme = e.target.value; });
  customThemeHex.addEventListener('input', e => {
    if (e.target.value.match(/^#[0-9a-f]{6}$/i)) { customThemeColor.value = e.target.value; if (profile) profile.universal_theme = e.target.value; }
  });

  // BG type
  bgTypeSelect.addEventListener('change', e => {
    if (profile) profile.background_type = e.target.value;
    bgUploadGroup.style.display = e.target.value === 'image' ? 'block' : 'none';
  });

  // Tilt
  document.getElementById('tilt-effect-checkbox').addEventListener('change', e => {
    if (profile) { profile.tilt_effect = e.target.checked; reloadPreview(); }
  });

  // Verified badge
  document.getElementById('verified-badge-checkbox').addEventListener('change', e => {
    if (!profile) return;
    if (e.target.checked) { if (!profile.badges.includes('verified')) profile.badges.push('verified'); }
    else profile.badges = profile.badges.filter(b => b !== 'verified');
    reloadPreview();
  });

  // Layout options
  document.querySelectorAll('.layout-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.layout-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      if (profile) { profile.layout_type = opt.dataset.layout; reloadPreview(); }
    });
  });

  // Widget modal
  document.getElementById('add-widget-btn').addEventListener('click', () => {
    currentEditingWidgetIndex = null;
    document.getElementById('modal-title').textContent = 'Add Widget';
    widgetTypeSelect.value = 'profile'; widgetTypeSelect.disabled = false;
    widgetTitleInput.value = ''; linksEditorList.innerHTML = '';
    document.getElementById('widget-text-body').value = '';
    document.getElementById('widget-spotify-url').value = '';
    toggleWidgetForms('profile');
    widgetModal.classList.add('open');
  });

  widgetTypeSelect.addEventListener('change', e => toggleWidgetForms(e.target.value));
  document.getElementById('close-modal').addEventListener('click', () => widgetModal.classList.remove('open'));
  document.getElementById('save-widget-modal-btn').addEventListener('click', applyWidgetFromModal);
  document.getElementById('add-link-input-btn').addEventListener('click', () => addLinkInputRow('', ''));

  // Discord
  const dlBtn = document.getElementById('discord-link-btn');
  if (dlBtn) dlBtn.addEventListener('click', async () => {
    const r = await fetch('/api/discord/configured').then(x => x.json()).catch(() => ({ configured: false }));
    if (!r.configured) { showToast('Discord OAuth not configured. Add credentials to .env', true); return; }
    window.location.href = '/auth/discord?mode=dashboard';
  });
  const duBtn = document.getElementById('discord-unlink-btn');
  if (duBtn) duBtn.addEventListener('click', async () => {
    const r = await fetch('/api/discord/unlink', { method: 'POST' }).then(x => x.json()).catch(() => ({}));
    if (r.message) {
      showToast('Discord unlinked.');
      currentUser.discord_id = null; loadDiscordStatus(currentUser);
    } else showToast(r.error || 'Failed to unlink.', true);
  });

  // Font select
  fontSelect.addEventListener('change', e => { if (profile) { profile.font_family = e.target.value; reloadPreview(); } });
}

function confirmLogout() {
  fetch('/api/auth/logout', { method: 'POST' }).then(() => window.location.href = '/login');
}

// ── Widget helpers ────────────────────────────────────────────────
function toggleWidgetForms(type) {
  configLinks.style.display  = type === 'links'   ? 'block' : 'none';
  configText.style.display   = type === 'text'    ? 'block' : 'none';
  configSpotify.style.display = type === 'spotify' ? 'block' : 'none';
}

function addLinkInputRow(label, url) {
  const row = document.createElement('div');
  row.className = 'link-inputs-group';
  row.innerHTML = `
    <button style="position:absolute;top:8px;right:8px;background:none;border:none;color:#666;cursor:pointer;font-size:16px;line-height:1;" onclick="this.parentElement.remove()">×</button>
    <div class="form-group" style="margin-bottom:8px;">
      <label class="form-label">Label</label>
      <input type="text" class="input-field link-label" value="${label}" placeholder="e.g. Instagram" style="padding:8px 12px;font-size:13px;">
    </div>
    <div class="form-group">
      <label class="form-label">URL</label>
      <input type="text" class="input-field link-url" value="${url}" placeholder="https://instagram.com/..." style="padding:8px 12px;font-size:13px;">
    </div>`;
  linksEditorList.appendChild(row);
}

function renderWidgetsList() {
  const container = document.getElementById('widget-list');
  container.innerHTML = '';
  if (!profile?.widgets?.length) {
    container.innerHTML = '<div style="color:#444;font-size:13px;text-align:center;padding:20px;">No widgets yet. Add one above!</div>';
    return;
  }
  profile.widgets.forEach((widget, index) => {
    const label = widget.title || (widget.type.charAt(0).toUpperCase() + widget.type.slice(1));
    const item = document.createElement('div');
    item.className = 'widget-item';
    item.innerHTML = `
      <div class="widget-info">
        <span class="widget-type">${label}</span>
        <span class="widget-dims">${widget.type} · ${widget.w || 6}×${widget.h || 2}</span>
      </div>
      <div class="widget-controls">
        <button class="icon-btn" onclick="moveWidget(${index}, -1)" title="Move Up">↑</button>
        <button class="icon-btn" onclick="moveWidget(${index}, 1)" title="Move Down">↓</button>
        <button class="icon-btn" onclick="editWidget(${index})" title="Edit">⚙</button>
        <button class="icon-btn danger" onclick="deleteWidget(${index})" title="Delete">🗑</button>
      </div>`;
    container.appendChild(item);
  });
}

window.moveWidget = function(index, dir) {
  const ni = index + dir;
  if (ni < 0 || ni >= profile.widgets.length) return;
  [profile.widgets[index], profile.widgets[ni]] = [profile.widgets[ni], profile.widgets[index]];
  recalcGrid(); renderWidgetsList(); reloadPreview();
};

window.editWidget = function(index) {
  currentEditingWidgetIndex = index;
  const w = profile.widgets[index];
  document.getElementById('modal-title').textContent = 'Edit Widget';
  widgetTypeSelect.value = w.type; widgetTypeSelect.disabled = true;
  widgetTitleInput.value = w.title || '';
  linksEditorList.innerHTML = '';
  document.getElementById('widget-text-body').value = '';
  document.getElementById('widget-spotify-url').value = '';
  toggleWidgetForms(w.type);
  if (w.type === 'links' && w.links) w.links.forEach(l => addLinkInputRow(l.label, l.url));
  else if (w.type === 'text') document.getElementById('widget-text-body').value = w.body || '';
  else if (w.type === 'spotify') document.getElementById('widget-spotify-url').value = w.embedUrl || '';
  widgetModal.classList.add('open');
};

window.deleteWidget = function(index) {
  profile.widgets.splice(index, 1);
  recalcGrid(); renderWidgetsList(); reloadPreview();
  showToast('Widget deleted.');
};

function recalcGrid() {
  let y = 0;
  profile.widgets.forEach(w => { w.x = 0; w.y = y; y += parseInt(w.h || 2); });
}

function applyWidgetFromModal() {
  const type  = widgetTypeSelect.value;
  const title = widgetTitleInput.value.trim();
  const config = {
    id: currentEditingWidgetIndex !== null ? profile.widgets[currentEditingWidgetIndex].id : 'w_' + Date.now(),
    type, title, w: 6, h: 2
  };

  if (type === 'links') {
    const rows = linksEditorList.querySelectorAll('.link-inputs-group');
    config.links = [...rows].map(row => ({
      label: row.querySelector('.link-label').value.trim(),
      url:   row.querySelector('.link-url').value.trim()
    })).filter(l => l.label && l.url);
  } else if (type === 'text') {
    config.body = document.getElementById('widget-text-body').value;
  } else if (type === 'spotify') {
    config.embedUrl = document.getElementById('widget-spotify-url').value.trim();
  }

  if (currentEditingWidgetIndex !== null) {
    const ex = profile.widgets[currentEditingWidgetIndex];
    config.x = ex.x; config.y = ex.y;
    profile.widgets[currentEditingWidgetIndex] = config;
  } else {
    let maxY = 0;
    profile.widgets.forEach(w => { if ((w.y + w.h) > maxY) maxY = w.y + w.h; });
    config.x = 0; config.y = maxY;
    profile.widgets.push(config);
  }

  widgetModal.classList.remove('open');
  renderWidgetsList(); reloadPreview();
  showToast(currentEditingWidgetIndex !== null ? 'Widget updated.' : 'Widget added.');
}

// ── Save profile ──────────────────────────────────────────────────
function saveProfileData() {
  profile.display_name  = displayNameInput.value.trim();
  profile.bio           = bioInput.value.trim();
  profile.music_url     = musicUrlInput.value.trim();
  profile.tilt_effect   = document.getElementById('tilt-effect-checkbox').checked;
  profile.seo_title        = document.getElementById('seo-title').value.trim();
  profile.seo_description  = document.getElementById('seo-description').value.trim();
  profile.font_family      = fontSelect.value;

  const verifiedCB = document.getElementById('verified-badge-checkbox');
  if (verifiedCB.checked) { if (!profile.badges.includes('verified')) profile.badges.push('verified'); }
  else profile.badges = profile.badges.filter(b => b !== 'verified');

  const themeVal = themeSelect.value;
  profile.universal_theme = themeVal === 'custom' ? customThemeColor.value : themeVal;

  profile.colors = {
    bg_color:     colorInputs.bg_color.value,
    card_bg:      hexToRgba(colorInputs.card_bg.value, 0.7),
    border_color: hexToRgba(colorInputs.border_color.value, 0.05),
    text_color:   colorInputs.text_color.value,
    text_muted:   colorInputs.text_muted.value,
    accent_color: colorInputs.accent_color.value
  };

  document.getElementById('save-btn').textContent = 'Saving…';

  fetch('/api/profile/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile)
  })
    .then(r => r.json())
    .then(data => {
      document.getElementById('save-btn').textContent = 'Save Changes';
      if (data.profile) { profile = data.profile; showToast('Changes saved!'); reloadPreview(); }
      else showToast(data.error || 'Failed to save.', true);
    })
    .catch(() => { document.getElementById('save-btn').textContent = 'Save Changes'; showToast('Connection error.', true); });
}

// ── Preview ───────────────────────────────────────────────────────
function reloadPreview() {
  if (!profile || !currentUser) return;
  previewFrame.src = `/${currentUser.username}?preview=true&t=${Date.now()}`;
}

// ── Toast ─────────────────────────────────────────────────────────
function showToast(text, isError = false) {
  const toast = document.getElementById('toast');
  const icon  = document.getElementById('toast-icon');
  const msg   = document.getElementById('toast-text');
  msg.textContent = text;
  icon.textContent = isError ? '⚠' : '✔';
  icon.style.color = isError ? '#ff4a4a' : 'var(--accent-color)';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3200);
}

// ── Color helpers ──────────────────────────────────────────────────
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function rgbaToHex(rgba) {
  const parts = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!parts) return '#ffffff';
  const r = parseInt(parts[1]).toString(16).padStart(2,'0');
  const g = parseInt(parts[2]).toString(16).padStart(2,'0');
  const b = parseInt(parts[3]).toString(16).padStart(2,'0');
  return `#${r}${g}${b}`;
}
