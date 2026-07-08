/* ============================================================
   BioChew — profile.js
   Handles: profile dropdown, profile modal, settings modal,
            help modal, session history widget, health score,
            session notes, user data rendering.
   ============================================================ */

'use strict';

// ── USER DATA ──────────────────────────────────────────────
function getUser() {
    return JSON.parse(localStorage.getItem('biochew_user') || '{}');
}

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

// ── PROFILE DROPDOWN ──────────────────────────────────────
const profileTrigger  = document.getElementById('profile-trigger');
const profileDropdown = document.getElementById('profile-dropdown');

function openDropdown() {
    profileDropdown.classList.add('open');
    profileTrigger.classList.add('open');
    lucide.createIcons();
}

function closeDropdown() {
    profileDropdown.classList.remove('open');
    profileTrigger.classList.remove('open');
}

profileTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (profileDropdown.classList.contains('open')) {
        closeDropdown();
    } else {
        openDropdown();
    }
});

document.addEventListener('click', (e) => {
    if (!profileDropdown.contains(e.target) && !profileTrigger.contains(e.target)) {
        closeDropdown();
    }
});

// Close on Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeDropdown(); closeAllModals(); }
});

// ── POPULATE USER DATA IN HEADER + DROPDOWN ───────────────
function renderUserHeader() {
    const user = getUser();
    const name     = user.name || 'User';
    const email    = user.email || '–';
    const initials = getInitials(name);
    const photo    = user.photo || null;

    // Header avatar
    document.getElementById('header-username').textContent = name.split(' ')[0];
    document.getElementById('avatar-initials').textContent = initials;
    const avatarImg = document.getElementById('avatar-img');
    if (photo) { avatarImg.src = photo; avatarImg.style.display = 'block'; document.getElementById('avatar-initials').style.display = 'none'; }

    // Dropdown user card
    document.getElementById('dropdown-name').textContent  = name;
    document.getElementById('dropdown-email').textContent = email;
    document.getElementById('dropdown-initials').textContent = initials;
    const ddAvatarImg = document.getElementById('dropdown-avatar-img');
    if (photo) { ddAvatarImg.src = photo; ddAvatarImg.style.display = 'block'; document.getElementById('dropdown-initials').style.display = 'none'; }

    // Health strip
    const health = user.health;
    if (health) {
        const strip = document.getElementById('health-strip');
        strip.style.display = 'flex';
        if (health.bmi)        document.getElementById('hval-bmi').textContent = health.bmi;
        if (health.bpSys && health.bpDia) document.getElementById('hval-bp').textContent = `${health.bpSys}/${health.bpDia}`;
        if (health.bloodGroup) document.getElementById('hval-bg').textContent  = health.bloodGroup;
        lucide.createIcons();
    }
}

// ── MODAL HELPERS ─────────────────────────────────────────
function openModal(overlayId) {
    closeDropdown();
    const overlay = document.getElementById(overlayId);
    if (overlay) {
        overlay.classList.add('open');
        lucide.createIcons();
    }
}

function closeModal(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (overlay) overlay.classList.remove('open');
}

function closeAllModals() {
    ['profile-modal-overlay','settings-modal-overlay','help-modal-overlay'].forEach(closeModal);
}

// Close modals on overlay click
['profile-modal-overlay','settings-modal-overlay','help-modal-overlay'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', (e) => {
        if (e.target === el) closeModal(id);
    });
});

// Close buttons
document.getElementById('modal-close').addEventListener('click', () => closeModal('profile-modal-overlay'));
document.getElementById('settings-modal-close').addEventListener('click', () => closeModal('settings-modal-overlay'));
document.getElementById('help-modal-close').addEventListener('click', () => closeModal('help-modal-overlay'));

// ── VIEW PROFILE ──────────────────────────────────────────
document.getElementById('menu-view-profile').addEventListener('click', (e) => {
    e.preventDefault();
    renderProfileModal();
    openModal('profile-modal-overlay');
});

function renderProfileModal() {
    const user   = getUser();
    const health = user.health || {};
    const body   = document.getElementById('modal-body');
    const initials = getInitials(user.name || 'User');
    const photo = user.photo || null;

    const avatarHtml = photo
        ? `<img src="${photo}" alt="" style="width:100%;height:100%;object-fit:cover;">`
        : initials;

    let conditionsHtml = '<span class="condition-pill none">None reported</span>';
    if (health.conditions && health.conditions.length > 0 && !(health.conditions.length === 1 && health.conditions[0] === 'none')) {
        const labelMap = {
            'diabetes-t1':'Diabetes (T1)', 'diabetes-t2':'Diabetes (T2)',
            'hypertension':'Hypertension', 'hypotension':'Hypotension',
            'heart-disease':'Heart Disease', 'thyroid':'Thyroid Disorder',
            'gerd':'GERD', 'ibs':'IBS', 'tmj':'TMJ Disorder',
            'bruxism':'Bruxism', 'sleep-apnea':'Sleep Apnea',
            'anxiety':'Anxiety', 'stroke':'Stroke History', 'obesity':'Obesity'
        };
        conditionsHtml = health.conditions.filter(c => c !== 'none')
            .map(c => `<span class="condition-pill">${labelMap[c] || c}</span>`).join('');
    }

    // BMI category
    let bmiCategory = '';
    if (health.bmi) {
        const b = parseFloat(health.bmi);
        if (b < 18.5) bmiCategory = 'Underweight';
        else if (b < 25) bmiCategory = 'Normal';
        else if (b < 30) bmiCategory = 'Overweight';
        else bmiCategory = 'Obese';
    }

    const notesHtml = health.notes
        ? `<div class="notes-box">${health.notes}</div>`
        : `<div class="notes-box" style="color:var(--text-muted);font-style:italic;">No notes added.</div>`;

    if (!health.age && !health.height && !health.weight) {
        body.innerHTML = `
            <div class="profile-hero">
                <div class="profile-hero-avatar">${avatarHtml}</div>
                <div class="profile-hero-info">
                    <div class="profile-full-name">${user.name || 'User'}</div>
                    <div class="profile-full-email">${user.email || '–'}</div>
                    <span class="profile-provider-badge"><i data-lucide="check-circle" style="width:10px;height:10px;"></i> ${user.provider || 'email'}</span>
                </div>
            </div>
            <div class="no-health-data">
                <i data-lucide="clipboard-x"></i>
                <p>No health data saved yet. Complete your health profile to see detailed metrics here.</p>
                <a href="profile-setup.html" class="btn btn-primary btn-small"><i data-lucide="arrow-right"></i> Complete Health Profile</a>
            </div>`;
        lucide.createIcons({ nodes: [body] });
        return;
    }

    body.innerHTML = `
        <div class="profile-hero">
            <div class="profile-hero-avatar">${avatarHtml}</div>
            <div class="profile-hero-info">
                <div class="profile-full-name">${user.name || 'User'}</div>
                <div class="profile-full-email">${user.email || '–'}</div>
                <span class="profile-provider-badge"><i data-lucide="check-circle" style="width:10px;height:10px;"></i> ${user.provider || 'email'}</span>
            </div>
        </div>

        <div class="profile-data-grid">
            <div class="profile-data-item">
                <div class="pdi-label">Age</div>
                <div class="pdi-value accent">${health.age || '–'}</div>
                <div class="pdi-sub">years</div>
            </div>
            <div class="profile-data-item">
                <div class="pdi-label">Biological Sex</div>
                <div class="pdi-value">${health.gender ? (health.gender.charAt(0).toUpperCase() + health.gender.slice(1)) : '–'}</div>
            </div>
            <div class="profile-data-item">
                <div class="pdi-label">Height</div>
                <div class="pdi-value accent">${health.height || '–'}</div>
                <div class="pdi-sub">cm</div>
            </div>
            <div class="profile-data-item">
                <div class="pdi-label">Weight</div>
                <div class="pdi-value accent">${health.weight || '–'}</div>
                <div class="pdi-sub">kg</div>
            </div>
            <div class="profile-data-item">
                <div class="pdi-label">BMI</div>
                <div class="pdi-value ${health.bmi && parseFloat(health.bmi) >= 18.5 && parseFloat(health.bmi) < 25 ? 'green' : 'danger'}">${health.bmi || '–'}</div>
                <div class="pdi-sub">${bmiCategory}</div>
            </div>
            <div class="profile-data-item">
                <div class="pdi-label">Blood Group</div>
                <div class="pdi-value danger">${health.bloodGroup || '–'}</div>
            </div>
            <div class="profile-data-item">
                <div class="pdi-label">Blood Pressure</div>
                <div class="pdi-value ${health.bpSys && parseInt(health.bpSys) > 130 ? 'danger' : 'green'}">${health.bpSys && health.bpDia ? health.bpSys + '/' + health.bpDia : '–'}</div>
                <div class="pdi-sub">mmHg (sys/dia)</div>
            </div>
            <div class="profile-data-item">
                <div class="pdi-label">Fasting Blood Sugar</div>
                <div class="pdi-value ${health.sugarFast && parseInt(health.sugarFast) > 100 ? 'danger' : 'green'}">${health.sugarFast || '–'}</div>
                <div class="pdi-sub">mg/dL</div>
            </div>
        </div>

        <div class="profile-section-title">Past Medical Conditions</div>
        <div class="conditions-list">${conditionsHtml}</div>

        <div class="profile-section-title">Notes & Medications</div>
        ${notesHtml}

        <div style="margin-top:1.25rem; text-align:center;">
            <a href="profile-setup.html" class="btn btn-outline" style="font-size:0.82rem;">
                <i data-lucide="pencil"></i> Update Health Profile
            </a>
        </div>
    `;
    lucide.createIcons({ nodes: [body] });
}

// ── SETTINGS ──────────────────────────────────────────────
document.getElementById('menu-settings').addEventListener('click', (e) => {
    e.preventDefault();
    openModal('settings-modal-overlay');
});

// ── HELP ──────────────────────────────────────────────────
document.getElementById('menu-help').addEventListener('click', (e) => {
    e.preventDefault();
    openModal('help-modal-overlay');
    lucide.createIcons();
});

// ── CHANGE ACCOUNT ────────────────────────────────────────
// ── CHANGE ACCOUNT ────────────────────────────────────────
document.getElementById('menu-change-account').addEventListener('click', (e) => {
    e.preventDefault();
    closeDropdown();
    if (confirm('Switch account? You will be signed out of BioChew.')) {
        if (typeof window.syncCurrentUserToDatabase === 'function') {
            window.syncCurrentUserToDatabase();
        }
        localStorage.removeItem('biochew_user');
        localStorage.removeItem('biochew_session_history');
        localStorage.removeItem('biochew_session_notes');
        window.location.href = 'auth.html';
    }
});

// ── PRIVACY ───────────────────────────────────────────────
document.getElementById('menu-privacy').addEventListener('click', (e) => {
    e.preventDefault();
    closeDropdown();
    alert('BioChew Privacy Policy\n\nAll your data is stored locally on your device using browser localStorage.\nNo data is transmitted to any external server.\nYou can delete all data at any time via Settings → Data & Privacy.');
});

// ── LOGOUT ────────────────────────────────────────────────
document.getElementById('menu-logout').addEventListener('click', () => {
    if (typeof window.syncCurrentUserToDatabase === 'function') {
        window.syncCurrentUserToDatabase();
    }
    localStorage.removeItem('biochew_user');
    localStorage.removeItem('biochew_session_history');
    localStorage.removeItem('biochew_session_notes');
});

// ── CONFIRM DELETE HEALTH ─────────────────────────────────
window.confirmDeleteHealth = function() {
    if (confirm('Delete all health profile data? This cannot be undone.')) {
        const user = getUser();
        delete user.health;
        delete user.photo;
        localStorage.setItem('biochew_user', JSON.stringify(user));
        
        if (typeof window.syncCurrentUserToDatabase === 'function') {
            window.syncCurrentUserToDatabase();
        }
        
        renderUserHeader();
        closeModal('settings-modal-overlay');
        alert('Health profile data deleted.');
    }
};

// ── SESSION HISTORY WIDGET ────────────────────────────────
const SESSION_HISTORY_KEY = 'biochew_session_history';

// ── SYNC CURRENT USER STATE TO LOCAL DATABASE ─────────────
window.syncCurrentUserToDatabase = function() {
    const user = JSON.parse(localStorage.getItem('biochew_user') || '{}');
    if (!user.email && !user.phone) return;

    const history = JSON.parse(localStorage.getItem('biochew_session_history') || '[]');
    const notes = JSON.parse(localStorage.getItem('biochew_session_notes') || '[]');

    const usersDb = JSON.parse(localStorage.getItem('biochew_users_db') || '[]');
    const matchingIdx = usersDb.findIndex(u => 
        (user.email && u.email.toLowerCase() === user.email.toLowerCase()) || 
        (user.phone && u.phone.trim() === user.phone.trim())
    );

    if (matchingIdx !== -1) {
        usersDb[matchingIdx].health = user.health || {};
        usersDb[matchingIdx].photo = user.photo || null;
        usersDb[matchingIdx].name = user.name || usersDb[matchingIdx].name;
        usersDb[matchingIdx].history = history;
        usersDb[matchingIdx].notes = notes;
        localStorage.setItem('biochew_users_db', JSON.stringify(usersDb));
    }
};

function getSessionHistory() {
    try {
        return JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY) || '[]');
    } catch (e) {
        return [];
    }
}

function saveSessionToHistory(chewCount, cpm, duration) {
    if (!chewCount || parseInt(chewCount) === 0) return;
    
    let safeCpm = parseFloat(cpm);
    if (isNaN(safeCpm) || !isFinite(safeCpm)) safeCpm = 0.0;
    
    let safeDuration = parseFloat(duration);
    if (isNaN(safeDuration) || !isFinite(safeDuration)) safeDuration = 0.0;

    const history = getSessionHistory();
    history.unshift({
        date: new Date().toLocaleString(),
        chewCount: parseInt(chewCount),
        cpm: parseFloat(safeCpm.toFixed(1)),
        duration: parseFloat(safeDuration.toFixed(1))
    });
    
    // Keep last 20 sessions
    if (history.length > 20) history.pop();
    localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(history));
    
    if (typeof logToConsole === 'function') {
        logToConsole(`Session saved successfully: ${chewCount} chews, ${safeCpm.toFixed(1)} CPM, ${safeDuration.toFixed(1)}s`, 'success');
    }
    
    renderSessionHistory();
    updateHealthScore();

    if (typeof window.syncCurrentUserToDatabase === 'function') {
        window.syncCurrentUserToDatabase();
    }
}

// Global live-updating history and health score engine
window.updateLiveHealthScoreAndHistory = function(liveChewCount, liveCpm, liveDuration, isSessionActive) {
    const history = getSessionHistory();
    const list    = document.getElementById('history-list');
    const badge   = document.getElementById('history-count-badge');
    const circle  = document.getElementById('score-ring-circle');

    const totalSessions = history.length + (isSessionActive && liveChewCount > 0 ? 1 : 0);
    if (badge) {
        badge.textContent = `${totalSessions} session${totalSessions !== 1 ? 's' : ''}`;
    }

    // 1. Render Session History with live-active item at top if session is active
    if (list) {
        let historyHtml = '';
        
        if (isSessionActive && liveChewCount > 0) {
            let cpmClass = '';
            if (liveCpm > 0 && liveCpm < 40) cpmClass = 'slow';
            else if (liveCpm >= 40 && liveCpm <= 90) cpmClass = 'ideal';
            else if (liveCpm > 90) cpmClass = 'fast';
            
            historyHtml += `
                <div class="history-item live-active-item" style="border: 1px dashed var(--primary-cyan); background: rgba(0, 240, 255, 0.06); padding: 0.8rem 1rem; border-radius: 12px; margin-bottom: 0.6rem; transition: all 0.3s ease; box-shadow: 0 0 10px rgba(0, 240, 255, 0.1);">
                    <div class="history-item-left">
                        <span class="history-item-date" style="color: var(--primary-cyan); font-weight: 700; font-size: 0.72rem; letter-spacing: 0.5px; text-transform: uppercase; display: flex; align-items: center; gap: 6px;">
                            <span class="pulse-dot" style="display:inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: var(--primary-cyan); animation: pulse 1.5s infinite;"></span>
                            Live Session
                        </span>
                        <span class="history-item-chews">${liveChewCount} chews · ${parseFloat(liveDuration).toFixed(1)}s</span>
                    </div>
                    <span class="history-item-cpm ${cpmClass}">${parseFloat(liveCpm).toFixed(1)} CPM</span>
                </div>`;
        }

        if (history.length === 0 && (!isSessionActive || liveChewCount === 0)) {
            list.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="clock"></i>
                    <p>No sessions recorded yet. Start your first session!</p>
                </div>`;
            if (typeof lucide !== 'undefined' && lucide.createIcons) {
                lucide.createIcons({ nodes: [list] });
            }
        } else {
            historyHtml += history.map(s => {
                let cpmClass = '';
                if (s.cpm > 0 && s.cpm < 40) cpmClass = 'slow';
                else if (s.cpm >= 40 && s.cpm <= 90) cpmClass = 'ideal';
                else if (s.cpm > 90) cpmClass = 'fast';
                return `
                    <div class="history-item">
                        <div class="history-item-left">
                            <span class="history-item-date">${s.date}</span>
                            <span class="history-item-chews">${s.chewCount} chews · ${s.duration}s</span>
                        </div>
                        <span class="history-item-cpm ${cpmClass}">${s.cpm} CPM</span>
                    </div>`;
            }).join('');
            list.innerHTML = historyHtml;
        }
    }

    // 2. Render Chewing Health Score Breakdown
    const elSessions = document.getElementById('si-sessions');
    if (elSessions) elSessions.textContent = totalSessions;

    const historicalChews = history.reduce((acc, s) => acc + s.chewCount, 0);
    const totalChews = historicalChews + (isSessionActive ? parseInt(liveChewCount) : 0);
    const elTotalChews = document.getElementById('si-total-chews');
    if (elTotalChews) elTotalChews.textContent = totalChews;

    if (history.length === 0 && (!isSessionActive || liveChewCount === 0)) {
        const elScore = document.getElementById('score-number');
        const elBadge = document.getElementById('health-score-badge');
        const elCpm = document.getElementById('si-cpm');
        const elBestCpm = document.getElementById('si-best-cpm');
        
        if (elScore) elScore.textContent = '–';
        if (elBadge) elBadge.textContent = '—';
        if (elCpm) elCpm.textContent = '–';
        if (elBestCpm) elBestCpm.textContent = '–';
        if (circle) circle.style.strokeDashoffset = '263.9';
        return;
    }

    // Average CPM calculation
    let avgCpm = 0;
    if (history.length > 0) {
        avgCpm = history.reduce((a, s) => a + s.cpm, 0) / history.length;
    }
    if (isSessionActive && liveChewCount > 0) {
        if (history.length > 0) {
            avgCpm = (avgCpm * history.length + parseFloat(liveCpm)) / (history.length + 1);
        } else {
            avgCpm = parseFloat(liveCpm);
        }
    }
    const elCpm = document.getElementById('si-cpm');
    if (elCpm) elCpm.textContent = avgCpm.toFixed(1);

    // Best CPM calculation
    let bestCpm = history.length > 0 ? Math.max(...history.map(s => s.cpm)) : 0.0;
    if (isSessionActive && parseFloat(liveCpm) > bestCpm) {
        bestCpm = parseFloat(liveCpm);
    }
    const elBestCpm = document.getElementById('si-best-cpm');
    if (elBestCpm) elBestCpm.textContent = bestCpm.toFixed(1);

    // Scoring algorithm
    let cpmScore = 0;
    if (avgCpm >= 40 && avgCpm <= 90) cpmScore = 50;
    else if (avgCpm > 20 && avgCpm < 110) cpmScore = 30;
    else cpmScore = 10;

    const consistencyBonus = Math.min(totalSessions * 5, 30);
    const volumeBonus = Math.min(totalChews / 100, 20);

    const score = Math.min(Math.round(cpmScore + consistencyBonus + volumeBonus), 100);
    
    const elScore = document.getElementById('score-number');
    if (elScore) elScore.textContent = score;

    let badgeText = 'Beginner';
    if (score >= 80) badgeText = '🏆 Excellent';
    else if (score >= 60) badgeText = '🌟 Good';
    else if (score >= 40) badgeText = '📈 Improving';
    
    const elBadge = document.getElementById('health-score-badge');
    if (elBadge) elBadge.textContent = badgeText;

    // Animate health ring
    if (circle) {
        const circumference = 263.9;
        const offset = circumference - (score / 100) * circumference;
        circle.style.strokeDashoffset = offset.toFixed(1);

        if (score >= 75) circle.style.stroke = 'var(--primary-green)';
        else if (score >= 50) circle.style.stroke = 'var(--primary-cyan)';
        else circle.style.stroke = 'var(--warning-orange)';
    }
};

function renderSessionHistory() {
    window.updateLiveHealthScoreAndHistory(0, 0, 0, false);
}

function updateHealthScore() {
    window.updateLiveHealthScoreAndHistory(0, 0, 0, false);
}

document.getElementById('btn-clear-history').addEventListener('click', () => {
    if (confirm('Clear all session history?')) {
        localStorage.removeItem(SESSION_HISTORY_KEY);
        renderSessionHistory();
        updateHealthScore();
        if (typeof window.syncCurrentUserToDatabase === 'function') {
            window.syncCurrentUserToDatabase();
        }
    }
});

// ── SESSION NOTES WIDGET ──────────────────────────────────
const NOTES_KEY = 'biochew_session_notes';

function getSavedNotes() {
    return JSON.parse(localStorage.getItem(NOTES_KEY) || '[]');
}

function renderSavedNotes() {
    const notes = getSavedNotes();
    const container = document.getElementById('saved-notes-list');
    if (!container) return;
    if (notes.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = notes.slice(0, 5).map(n => `
        <div class="saved-note">
            <div class="saved-note-time">${n.time}</div>
            <div>${n.text}</div>
        </div>`).join('');
}

document.getElementById('btn-save-note').addEventListener('click', () => {
    const input = document.getElementById('session-note-input');
    const text  = input.value.trim();
    if (!text) return;

    const notes = getSavedNotes();
    notes.unshift({ time: new Date().toLocaleString(), text });
    if (notes.length > 10) notes.pop();
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
    input.value = '';
    renderSavedNotes();

    if (typeof window.syncCurrentUserToDatabase === 'function') {
        window.syncCurrentUserToDatabase();
    }
});


// ── INIT ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    renderUserHeader();
    renderSessionHistory();
    updateHealthScore();
    renderSavedNotes();
    lucide.createIcons();
});

// Run immediately if DOM already loaded (script is deferred)
if (document.readyState !== 'loading') {
    renderUserHeader();
    renderSessionHistory();
    updateHealthScore();
    renderSavedNotes();
}
