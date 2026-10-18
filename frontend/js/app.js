// ===== App State =====
const appState = {
  currentUser: null,
  currentView: 'auth',
  activeExamData: [],
  currentIndex: 0,
  examMode: 'tutor', // 'tutor' | 'mock'
  examAnswers: {}, // q_id -> user answer
  submitted: {},   // q_id -> graded result
  timerInterval: null,
  timeRemaining: 0,
  examConfig: { examType: 'NCLEX-RN', count: 10, category: '' },
  categories: ['All'],
  categoriesLoaded: false,
  dashboard: null,
  dashboardLoading: false,
  dashboardLoaded: false,
  dashboardError: '',
  accountProfile: null,
  profileLoading: false,
  accountCurrentPassword: '',
  history: []
};

// ===== DOM refs =====
const main = document.getElementById('main');
const headerRight = document.getElementById('headerRight');
const toast = document.getElementById('toast');

window.addEventListener('beforeunload', (event) => {
  if (appState.currentView !== 'exam') return;
  event.preventDefault();
  event.returnValue = '';
});

// ===== Utilities =====
function showToast(msg, ms) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), ms || 2500);
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function wirePasswordToggle(inputId, buttonId) {
  const input = document.getElementById(inputId);
  const button = document.getElementById(buttonId);
  if (!input || !button) return;
  button.onclick = () => {
    const showPassword = input.type === 'password';
    input.type = showPassword ? 'text' : 'password';
    button.textContent = showPassword ? 'Hide' : 'Show';
    button.setAttribute('aria-label', `${showPassword ? 'Hide' : 'Show'} ${input.labels[0].textContent.toLowerCase()}`);
    button.setAttribute('aria-pressed', String(showPassword));
  };
}

function setLoading(html) {
  main.innerHTML = '<div class="loading-wrap"><div class="spinner"></div><p style="margin-top:12px;">' + (html || 'Loading...') + '</p></div>';
}

function showErrorState(msg, retryFn) {
  main.innerHTML = `
    <div class="error-state">
      <h3>Network Error</h3>
      <p style="color:var(--text-muted);margin-bottom:16px;">${escapeHtml(msg || 'Unable to reach the server. Your exam progress is preserved.')}</p>
      <button class="btn btn-primary" id="retryBtn">Retry</button>
    </div>`;
  document.getElementById('retryBtn').onclick = retryFn;
}

// ===== Routing =====
function setView(view) {
  appState.currentView = view;
  render();
}

function render() {
  updateHeader();
  switch (appState.currentView) {
    case 'auth': renderAuth(); break;
    case 'dashboard': renderDashboard(); break;
    case 'profile': renderProfile(); break;
    case 'config': renderConfig(); break;
    case 'exam': renderExam(); break;
    case 'review': renderReview(); break;
    default: renderAuth();
  }
}

function updateHeader() {
  if (appState.currentUser) {
    headerRight.innerHTML = `
      <span class="user-chip">${escapeHtml(appState.currentUser.email)}</span>
      ${appState.currentView !== 'exam' ? '<button class="btn btn-secondary" id="profileBtn" style="padding:6px 12px;font-size:13px;">Profile & Account</button>' : ''}
      <button class="btn btn-secondary" id="logoutBtn" style="padding:6px 12px;font-size:13px;">Logout</button>`;
    document.getElementById('logoutBtn').onclick = logout;
    const profileBtn = document.getElementById('profileBtn');
    if (profileBtn) profileBtn.onclick = () => {
      appState.accountProfile = null;
      appState.accountCurrentPassword = '';
      setView('profile');
    };
  } else {
    headerRight.innerHTML = '';
  }
}

function logout() {
  appState.currentUser = null;
  appState.activeExamData = [];
  appState.examAnswers = {};
  appState.submitted = {};
  appState.dashboard = null;
  appState.dashboardLoaded = false;
  appState.dashboardLoading = false;
  appState.dashboardError = '';
  appState.accountProfile = null;
  appState.profileLoading = false;
  appState.accountCurrentPassword = '';
  appState.history = [];
  localStorage.removeItem('np_user');
  setView('auth');
}

// ===== Auth Screen =====
let authMode = 'login'; // 'login' | 'register'

function renderAuth() {
  main.innerHTML = `
    <div class="auth-wrap ${authMode === 'register' ? 'auth-register-wrap' : ''}">
      <div class="card">
        <h1 class="auth-title">${authMode === 'login' ? 'Welcome back' : 'Create account'}</h1>
        <p class="auth-sub">${authMode === 'login' ? 'Sign in to continue your prep.' : 'Start your free exam prep journey.'}</p>
        <form id="authForm">
          ${authMode === 'register' ? `
          <div class="form-group">
            <label class="form-label" for="fullName">Name *</label>
            <input class="form-input" type="text" id="fullName" required autocomplete="name" />
          </div>` : ''}
          <div class="form-group">
            <label class="form-label" for="email">Email${authMode === 'register' ? ' *' : ''}</label>
            <input class="form-input" type="email" id="email" required autocomplete="email" />
            <div class="form-error" id="emailErr"></div>
          </div>
          <div class="form-group">
            <label class="form-label" for="password">Password${authMode === 'register' ? ' *' : ''}</label>
            <div class="password-input-wrap">
              <input class="form-input" type="password" id="password" required minlength="${authMode === 'register' ? 8 : 4}" autocomplete="${authMode === 'register' ? 'new-password' : 'current-password'}" />
              <button class="password-toggle" type="button" id="togglePassword" aria-label="Show password" aria-pressed="false">Show</button>
            </div>
            <div class="form-error" id="pwErr"></div>
          </div>
          ${authMode === 'register' ? `
          <div class="form-group">
            <label class="form-label" for="confirmPassword">Confirm password *</label>
            <div class="password-input-wrap">
              <input class="form-input" type="password" id="confirmPassword" required minlength="8" autocomplete="new-password" />
              <button class="password-toggle" type="button" id="toggleConfirmPassword" aria-label="Show confirm password" aria-pressed="false">Show</button>
            </div>
            <div class="form-error" id="confirmPasswordErr"></div>
          </div>
          <div class="form-group">
            <label class="form-label" for="mobile">Mobile *</label>
            <input class="form-input" type="tel" id="mobile" required autocomplete="tel" inputmode="tel" />
          </div>
          <div class="form-group">
            <label class="form-label" for="bloodGroup">Blood group</label>
            <select class="form-select" id="bloodGroup">
              <option value="">Select blood group</option>
              ${['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(group => `<option value="${group}">${group}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="birthDate">Birth date *</label>
            <input class="form-input" type="date" id="birthDate" required max="${todayLocalISO()}" />
          </div>
          <div class="form-group">
            <label class="form-label" for="nursingCollege">Nursing college name *</label>
            <input class="form-input" type="text" id="nursingCollege" required />
          </div>
          <div class="form-group">
            <label class="form-label" for="address">Address</label>
            <textarea class="form-input profile-textarea" id="address"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label" for="targetExam">Target exam *</label>
            <select class="form-select" id="targetExam" required>
              <option value="NCLEX-RN">NCLEX-RN</option>
              <option value="Prometric">Prometric (Middle East)</option>
            </select>
          </div>` : ''}
          ${authMode === 'register' ? '<p class="profile-privacy-note">Remember your password: you’ll need it to view or edit your profile information later.</p>' : ''}
          <button class="btn btn-primary btn-block" type="submit" id="authSubmit">
            ${authMode === 'login' ? 'Sign In' : 'Register'}
          </button>
        </form>
        <p style="text-align:center;margin-top:16px;font-size:14px;color:var(--text-muted);">
          ${authMode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <a class="toggle-link" id="toggleAuth">${authMode === 'login' ? 'Register' : 'Sign In'}</a>
        </p>
      </div>
    </div>`;
  document.getElementById('toggleAuth').onclick = () => { authMode = authMode === 'login' ? 'register' : 'login'; renderAuth(); };
  document.getElementById('authForm').onsubmit = handleAuthSubmit;
  wirePasswordToggle('password', 'togglePassword');
  wirePasswordToggle('confirmPassword', 'toggleConfirmPassword');
  const birthDate = document.getElementById('birthDate');
  if (birthDate) birthDate.max = todayLocalISO();
}

function validateEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

async function handleAuthSubmit(ev) {
  ev.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const emailErr = document.getElementById('emailErr');
  const pwErr = document.getElementById('pwErr');
  emailErr.textContent = ''; pwErr.textContent = '';
  let ok = true;
  if (!validateEmail(email)) { emailErr.textContent = 'Please enter a valid email.'; ok = false; }
  const minPasswordLength = authMode === 'register' ? 8 : 4;
  if (password.length < minPasswordLength) {
    pwErr.textContent = `Password must be at least ${minPasswordLength} characters.`;
    ok = false;
  }
  if (authMode === 'register') {
    const confirmPassword = document.getElementById('confirmPassword').value;
    const confirmPasswordErr = document.getElementById('confirmPasswordErr');
    confirmPasswordErr.textContent = '';
    if (password !== confirmPassword) {
      confirmPasswordErr.textContent = 'Passwords do not match.';
      ok = false;
    }
  }
  let registrationProfile = null;
  if (authMode === 'register') {
    const mobile = document.getElementById('mobile').value.trim();
    const digits = mobile.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) {
      showToast('Enter a valid mobile number with 7 to 15 digits.');
      return;
    }
    registrationProfile = {
      full_name: document.getElementById('fullName').value.trim(),
      mobile: mobile,
      blood_group: document.getElementById('bloodGroup').value,
      birth_date: document.getElementById('birthDate').value,
      nursing_college: document.getElementById('nursingCollege').value.trim(),
      address: document.getElementById('address').value.trim()
    };
  }
  if (!ok) return;
  const btn = document.getElementById('authSubmit');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    let res;
    if (authMode === 'login') {
      res = await Api.login(email, password);
    } else {
      const targetExam = document.getElementById('targetExam').value;
      res = await Api.register(email, password, targetExam, registrationProfile);
    }
    if (res && res.success) {
      appState.currentUser = { user_id: res.user_id, email: email, target_exam: res.target_exam };
      localStorage.setItem('np_user', JSON.stringify(appState.currentUser));
      showToast(authMode === 'login' ? 'Welcome back!' : 'Account created!');
      setView('dashboard');
    } else {
      showToast(res.error || 'Authentication failed.');
    }
  } catch (err) {
    showErrorState(err.message, () => renderAuth());
  } finally {
    btn.disabled = false;
    btn.textContent = authMode === 'login' ? 'Sign In' : 'Register';
  }
}

// ===== Dashboard data loading =====
async function loadDashboardData() {
  if (!appState.currentUser) return;
  appState.dashboardLoading = true;
  appState.dashboardError = '';
  renderDashboard();
  try {
    const res = await Api.getDashboard(appState.currentUser.user_id);
    if (!res || !res.success) {
      if (res && res.error === 'Unknown GET action: get_dashboard') {
        throw new Error('The deployed Google Apps Script is out of date and does not support dashboard sessions. In Apps Script, open Deploy > Manage deployments, edit the web app deployment, select New version, and deploy it. Keep the deployment URL configured in frontend/js/api.js.');
      }
      throw new Error((res && res.error) || 'Unable to load session data.');
    }
    appState.dashboard = {
      sessions: Array.isArray(res.sessions) ? res.sessions : [],
      categoryStats: Array.isArray(res.categoryStats) ? res.categoryStats : [],
      overall: res.overall || {}
    };
    appState.history = appState.dashboard.sessions.map(s => ({
      mode: s.mode,
      examType: s.exam_type || appState.currentUser.target_exam,
      score: Number(s.score) || 0,
      timestamp: s.timestamp,
      sessionId: s.session_id
    }));
  } catch (err) {
    appState.dashboardError = err && err.message ? err.message : 'Unable to load session data.';
  } finally {
    appState.dashboardLoading = false;
    appState.dashboardLoaded = true;
    renderDashboard();
  }
}

function catColor(acc) {
  if (acc >= 80) return 'var(--success-green)';
  if (acc >= 60) return 'var(--warning-amber)';
  return 'var(--error-red)';
}

function parseSessionDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ===== Dashboard =====
function renderDashboard() {
  const u = appState.currentUser;
  const d = appState.dashboard || {};
  const overall = d.overall || {};
  const sessions = d.sessions || [];
  const catStats = d.categoryStats || [];
  const loading = appState.dashboardLoading;

  if (!appState.dashboardLoaded && !loading) {
    // kick off load after render
    setTimeout(loadDashboardData, 0);
  }

  const sessionsCount = overall.sessions != null ? overall.sessions : appState.history.length;
  const avg = overall.avgScore != null ? overall.avgScore : avgScore();
  const best = overall.bestScore != null ? overall.bestScore : (appState.history.length ? Math.max.apply(null, appState.history.map(h=>h.score)) : 0);
  const totalQ = overall.totalQuestions != null ? overall.totalQuestions : 0;
  const overallAcc = overall.overallAccuracy != null ? overall.overallAccuracy : 0;

  // score trend bars (last 8 sessions, oldest->newest)
  const orderedSessions = sessions
    .map((session, index) => ({ session, index, date: parseSessionDate(session.timestamp) }))
    .sort((a, b) => {
      if (a.date && b.date) return b.date - a.date;
      if (a.date) return -1;
      if (b.date) return 1;
      return a.index - b.index;
    });
  const trend = orderedSessions.slice(0, 8).reverse();
  const maxScore = 100;
  const barsHtml = trend.length ? trend.map(({ session, date }) => {
    const score = Math.min(maxScore, Math.max(0, Number(session.score) || 0));
    const h = Math.max(4, Math.round((score / maxScore) * 80));
    const color = score >= 70 ? 'var(--success-green)' : (score >= 50 ? 'var(--warning-amber)' : 'var(--error-red)');
    const sessionLabel = session.mode === 'mock' ? 'Mock Exam' : session.mode === 'tutor' ? 'Tutor Mode' : session.mode || 'Exam';
    const dateLabel = date ? date.toLocaleDateString(undefined,{month:'short',day:'numeric'}) : 'Date unavailable';
    const tooltip = `${sessionLabel} · ${score}%${date ? ' · ' + date.toLocaleString() : ''}`;
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:28px;">
      <div title="${escapeHtml(tooltip)}" style="font-size:11px;font-weight:600;color:${color};">${score}%</div>
      <div title="${escapeHtml(tooltip)}" style="width:100%;max-width:32px;height:${h}px;background:${color};border-radius:4px 4px 0 0;min-height:4px;"></div>
      <div title="${escapeHtml(tooltip)}" style="font-size:10px;color:var(--text-muted);">${escapeHtml(dateLabel)}</div>
    </div>`;
  }).join('') : '<p style="color:var(--text-muted);font-size:13px;">No sessions yet. Start practicing to see your trend.</p>';

  // category strength rows
  const catRows = catStats.length ? catStats.map(c => `
    <div style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
        <span style="font-weight:600;">${escapeHtml(c.category)}</span>
        <span style="color:${catColor(c.accuracy)};font-weight:700;">${c.accuracy}% <span style="color:var(--text-muted);font-weight:400;">(${c.correct}/${c.total})</span></span>
      </div>
      <div style="height:8px;background:var(--surface-gray);border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${c.accuracy}%;background:${catColor(c.accuracy)};border-radius:4px;"></div>
      </div>
      <div style="margin-top:4px;">
        <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;" data-cat="${escapeHtml(c.category)}" data-practice>Practice</button>
      </div>
    </div>`).join('') : (loading ? '<p style="color:var(--text-muted);font-size:13px;">Loading...</p>' : '<p style="color:var(--text-muted);font-size:13px;">No category data yet.</p>');

  // weak categories (accuracy < 70 with at least 3 attempts)
  const weak = catStats.filter(c => c.total >= 3 && c.accuracy < 70);

  main.innerHTML = `
    <div class="card">
      <h1 style="font-size:22px;font-weight:700;margin-bottom:4px;">Hello, ${escapeHtml(u.email.split('@')[0])}</h1>
      <p style="color:var(--text-muted);margin-bottom:20px;">Target exam: <strong>${escapeHtml(u.target_exam)}</strong></p>
      ${loading ? '<div class="loading-wrap"><div class="spinner"></div><p style="margin-top:12px;">Loading analytics...</p></div>' : appState.dashboardError ? `
      <div class="error-state">
        <h3>Session data unavailable</h3>
        <p style="color:var(--text-muted);margin-bottom:16px;">${escapeHtml(appState.dashboardError)}</p>
        <button class="btn btn-primary" id="retryDashboardBtn">Retry</button>
      </div>` : `
      <div class="dashboard-grid">
        <div class="stat-card">
          <div class="stat-label">Target Exam</div>
          <div class="stat-value" style="font-size:20px;">${escapeHtml(u.target_exam)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Sessions Taken</div>
          <div class="stat-value">${sessionsCount}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Avg Score</div>
          <div class="stat-value">${avg}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Best Score</div>
          <div class="stat-value">${best}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Questions Answered</div>
          <div class="stat-value">${totalQ}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Overall Accuracy</div>
          <div class="stat-value">${overallAcc}%</div>
        </div>
      </div>
      <button class="btn btn-primary btn-block" id="startExamBtn" style="margin-top:8px;">Start New Exam / Practice</button>`}
    </div>

    ${!loading && !appState.dashboardError ? `
    <div class="card">
      <h2 class="section-title" style="margin-top:0;">Score Trend</h2>
      <div style="display:flex;align-items:flex-end;gap:8px;padding:12px 0 4px;min-height:110px;border-bottom:1px solid var(--border-gray);">
        ${barsHtml}
      </div>
    </div>

    <div class="card">
      <h2 class="section-title" style="margin-top:0;">Category Strength</h2>
      ${catRows}
      ${weak.length ? `<div style="margin-top:12px;padding:12px;background:var(--error-red-soft);border-radius:var(--radius-sm);font-size:13px;">
        <strong>Focus areas:</strong> ${weak.map(w=>escapeHtml(w.category)).join(', ')}
      </div>` : ''}
    </div>

    ${sessions.length ? `
    <div class="card">
      <h2 class="section-title" style="margin-top:0;">Recent Sessions</h2>
      ${orderedSessions.slice(0,10).map(({session: h, date}) => {
        const sessionLabel = h.mode === 'mock' ? 'Mock Exam' : h.mode === 'tutor' ? 'Tutor Mode' : h.mode || 'Exam';
        const score = Math.min(100, Math.max(0, Number(h.score) || 0));
        return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-gray);">
          <div>
            <div style="font-weight:600;">${escapeHtml(sessionLabel)} — ${escapeHtml(h.exam_type || u.target_exam)}</div>
            <div style="font-size:12px;color:var(--text-muted);">${date ? date.toLocaleString() : 'Date unavailable'}${Number(h.total) > 0 ? ` · ${Number(h.correct) || 0}/${Number(h.total)} correct` : ''}</div>
          </div>
          <span style="font-weight:700;color:${score>=70?'var(--success-green)':score>=50?'var(--warning-amber)':'var(--error-red)'};">${score}%</span>
        </div>`}).join('')}
    </div>` : ''}` : ''}`;

  const btn = document.getElementById('startExamBtn');
  if (btn) btn.onclick = () => setView('config');
  const retryBtn = document.getElementById('retryDashboardBtn');
  if (retryBtn) retryBtn.onclick = loadDashboardData;

  document.querySelectorAll('[data-practice]').forEach(b => {
    b.onclick = () => {
      appState.examConfig.category = b.dataset.cat;
      appState.examConfig.examType = u.target_exam;
      setView('config');
    };
  });
}

function avgScore() {
  if (!appState.history.length) return 0;
  const sum = appState.history.reduce((a,h)=>a+h.score,0);
  return Math.round(sum / appState.history.length);
}

function todayLocalISO() {
  const today = new Date();
  return [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
}

function formatAge(birthDate) {
  if (!birthDate) return 'Add a birthday to calculate your age.';
  const parts = birthDate.split('-').map(Number);
  const birth = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (birth.getFullYear() !== parts[0] || birth.getMonth() !== parts[1] - 1 ||
      birth.getDate() !== parts[2] || birth > today) return 'Enter a valid birthday.';

  let years = today.getFullYear() - birth.getFullYear();
  let months = today.getMonth() - birth.getMonth();
  let days = today.getDate() - birth.getDate();
  if (days < 0) {
    months--;
    days += new Date(today.getFullYear(), today.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years--;
    months += 12;
  }
  return `${years} years, ${months} months, ${days} days`;
}

function renderProfile() {
  const profile = appState.accountProfile || {};
  const groups = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  main.innerHTML = `
    <div class="card profile-card">
      <h1 class="auth-title">Profile &amp; Account</h1>
      <p class="auth-sub">Manage your profile details, target exam, and password.</p>
      <p class="profile-privacy-note">Profile details are stored in the app’s linked Google Sheet. Blood group, address, nursing college, and birthday are optional; only share details you are comfortable providing.</p>
      <form id="profileForm">
        <div class="form-group">
          <label class="form-label" for="currentPassword">Current password</label>
          <div class="password-input-wrap">
            <input class="form-input" type="password" id="currentPassword" required autocomplete="current-password" value="${escapeHtml(appState.accountCurrentPassword)}" />
            <button class="password-toggle" type="button" id="toggleCurrentPassword" aria-label="Show current password" aria-pressed="false">Show</button>
          </div>
          <small class="profile-help">Required to view or save your private profile details.</small>
        </div>
        ${appState.accountProfile ? `
          <h2 class="section-title profile-section-title">Personal details</h2>
          <div class="profile-grid">
            <div class="form-group">
              <label class="form-label" for="fullName">Full name *</label>
              <input class="form-input" id="fullName" name="full_name" required autocomplete="name" value="${escapeHtml(profile.full_name || '')}" />
            </div>
            <div class="form-group">
              <label class="form-label" for="mobile">Mobile number *</label>
              <input class="form-input" id="mobile" name="mobile" type="tel" required autocomplete="tel" inputmode="tel" value="${escapeHtml(profile.mobile || '')}" />
              <small class="profile-help">Include country code when applicable.</small>
            </div>
            <div class="form-group">
              <label class="form-label" for="bloodGroup">Blood group</label>
              <select class="form-select" id="bloodGroup" name="blood_group">
                ${groups.map(group => `<option value="${group}" ${profile.blood_group === group ? 'selected' : ''}>${group || 'Select blood group'}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="nursingCollege">Nursing college</label>
              <input class="form-input" id="nursingCollege" name="nursing_college" value="${escapeHtml(profile.nursing_college || '')}" />
            </div>
            <div class="form-group">
              <label class="form-label" for="isRegistered">Nursing registration *</label>
              <select class="form-select" id="isRegistered" name="is_registered" required>
                <option value="">Select Yes or No</option>
                <option value="Yes" ${profile.is_registered === 'Yes' ? 'selected' : ''}>Yes</option>
                <option value="No" ${profile.is_registered === 'No' ? 'selected' : ''}>No</option>
              </select>
            </div>
            <div class="form-group" id="rnNumberGroup" ${profile.is_registered === 'Yes' ? '' : 'hidden'}>
              <label class="form-label" for="rnNumber">RN number *</label>
              <input class="form-input" id="rnNumber" name="rn_number" value="${escapeHtml(profile.rn_number || '')}" ${profile.is_registered === 'Yes' ? 'required' : ''} />
            </div>
            <div class="form-group">
              <label class="form-label" for="birthDate">Birthday</label>
              <input class="form-input" type="date" id="birthDate" name="birth_date" max="${todayLocalISO()}" value="${escapeHtml(profile.birth_date || '')}" />
              <small class="profile-help">Age: <strong id="ageDisplay">${escapeHtml(formatAge(profile.birth_date || ''))}</strong></small>
            </div>
            <div class="form-group">
              <label class="form-label" for="targetExamSetting">Target exam *</label>
              <select class="form-select" id="targetExamSetting" name="target_exam" required>
                <option value="NCLEX-RN" ${appState.currentUser.target_exam === 'NCLEX-RN' ? 'selected' : ''}>NCLEX-RN</option>
                <option value="Prometric" ${appState.currentUser.target_exam === 'Prometric' ? 'selected' : ''}>Prometric (Middle East)</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="address">Address</label>
            <textarea class="form-input profile-textarea" id="address" name="address">${escapeHtml(profile.address || '')}</textarea>
          </div>

          <h2 class="section-title profile-section-title">Change password (optional)</h2>
          <div class="profile-grid">
            <div class="form-group">
              <label class="form-label" for="newPassword">New password</label>
              <div class="password-input-wrap">
                <input class="form-input" type="password" id="newPassword" autocomplete="new-password" minlength="8" />
                <button class="password-toggle" type="button" id="toggleNewPassword" aria-label="Show new password" aria-pressed="false">Show</button>
              </div>
              <small class="profile-help">Leave blank to keep your current password. Use at least 8 characters.</small>
            </div>
            <div class="form-group">
              <label class="form-label" for="confirmPassword">Confirm new password</label>
              <div class="password-input-wrap">
                <input class="form-input" type="password" id="confirmPassword" autocomplete="new-password" />
                <button class="password-toggle" type="button" id="toggleConfirmPassword" aria-label="Show confirm new password" aria-pressed="false">Show</button>
              </div>
            </div>
          </div>
          <button class="btn btn-primary btn-block" type="submit" id="saveProfileBtn">Save Profile &amp; Account</button>
          <section class="delete-account-section" aria-labelledby="deleteAccountTitle">
            <h2 id="deleteAccountTitle">Delete account</h2>
            <p>This permanently deletes your account, profile, exam sessions, and progress. This cannot be undone.</p>
            <button class="btn btn-danger btn-block" type="button" id="deleteAccountBtn">Delete Account</button>
            <div id="deleteAccountConfirmation" hidden>
              <div class="form-group">
                <label class="form-label" for="deleteConfirmationText">Type DELETE to confirm</label>
                <input class="form-input" type="text" id="deleteConfirmationText" autocomplete="off" />
              </div>
              <div class="profile-delete-actions">
                <button class="btn btn-secondary" type="button" id="cancelAccountDeleteBtn">Cancel</button>
                <button class="btn btn-danger" type="button" id="confirmAccountDeleteBtn" disabled>Delete Account Permanently</button>
              </div>
            </div>
          </section>
        ` : `
          <button class="btn btn-primary btn-block" type="button" id="loadProfileBtn" ${appState.profileLoading ? 'disabled' : ''}>
            ${appState.profileLoading ? '<span class="spinner"></span> Loading profile...' : 'Continue to Profile'}
          </button>
        `}
        <button class="btn btn-secondary btn-block profile-back-btn" type="button" id="profileBackBtn">Back to Dashboard</button>
      </form>
    </div>`;

  document.getElementById('profileBackBtn').onclick = () => {
    appState.accountProfile = null;
    appState.accountCurrentPassword = '';
    setView('dashboard');
  };
  const loadButton = document.getElementById('loadProfileBtn');
  if (loadButton) loadButton.onclick = loadProfile;
  wirePasswordToggle('currentPassword', 'toggleCurrentPassword');
  wirePasswordToggle('newPassword', 'toggleNewPassword');
  wirePasswordToggle('confirmPassword', 'toggleConfirmPassword');

  const registration = document.getElementById('isRegistered');
  if (registration) registration.onchange = () => {
    const rnGroup = document.getElementById('rnNumberGroup');
    const rnNumber = document.getElementById('rnNumber');
    const isRegistered = registration.value === 'Yes';
    rnGroup.hidden = !isRegistered;
    rnNumber.required = isRegistered;
    if (!isRegistered) rnNumber.value = '';
  };

  const birthday = document.getElementById('birthDate');
  if (birthday) birthday.onchange = () => {
    document.getElementById('ageDisplay').textContent = formatAge(birthday.value);
  };

  const form = document.getElementById('profileForm');
  if (appState.accountProfile) {
    form.onsubmit = handleProfileSave;
    document.getElementById('deleteAccountBtn').onclick = showAccountDeleteConfirmation;
    document.getElementById('deleteConfirmationText').oninput = (event) => {
      document.getElementById('confirmAccountDeleteBtn').disabled = event.target.value !== 'DELETE';
    };
    document.getElementById('cancelAccountDeleteBtn').onclick = () => {
      document.getElementById('deleteConfirmationText').value = '';
      document.getElementById('deleteAccountConfirmation').hidden = true;
      document.getElementById('confirmAccountDeleteBtn').disabled = true;
      document.getElementById('deleteAccountBtn').focus();
    };
    document.getElementById('confirmAccountDeleteBtn').onclick = handleAccountDelete;
  }
}

async function loadProfile() {
  appState.accountCurrentPassword = document.getElementById('currentPassword').value;
  appState.profileLoading = true;
  renderProfile();
  try {
    const result = await Api.getProfile(appState.currentUser.user_id, appState.accountCurrentPassword);
    if (!result || !result.success) {
      throw new Error((result && result.error) || 'Unable to load profile.');
    }
    appState.accountProfile = result.profile || {};
    appState.currentUser.target_exam = result.target_exam || appState.currentUser.target_exam;
    localStorage.setItem('np_user', JSON.stringify(appState.currentUser));
    showToast('Profile loaded.');
  } catch (err) {
    showToast(err.message || 'Unable to load profile.');
  } finally {
    appState.profileLoading = false;
    renderProfile();
  }
}

async function handleProfileSave(event) {
  event.preventDefault();
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  if (newPassword && newPassword !== confirmPassword) {
    showToast('New password and confirmation do not match.');
    return;
  }
  const mobileDigits = document.getElementById('mobile').value.replace(/\D/g, '');
  if (mobileDigits.length < 7 || mobileDigits.length > 15) {
    showToast('Enter a valid mobile number with 7 to 15 digits.');
    return;
  }

  const saveButton = document.getElementById('saveProfileBtn');
  saveButton.disabled = true;
  saveButton.textContent = 'Saving...';
  const profile = {
    full_name: document.getElementById('fullName').value.trim(),
    mobile: document.getElementById('mobile').value.trim(),
    blood_group: document.getElementById('bloodGroup').value,
    address: document.getElementById('address').value.trim(),
    nursing_college: document.getElementById('nursingCollege').value.trim(),
    is_registered: document.getElementById('isRegistered').value,
    rn_number: document.getElementById('rnNumber').value.trim(),
    birth_date: document.getElementById('birthDate').value
  };
  try {
    const result = await Api.updateAccount(
      appState.currentUser.user_id,
      appState.accountCurrentPassword,
      document.getElementById('targetExamSetting').value,
      profile,
      newPassword
    );
    if (!result || !result.success) {
      throw new Error((result && result.error) || 'Unable to save profile.');
    }
    appState.accountProfile = result.profile || profile;
    appState.currentUser.target_exam = result.target_exam;
    appState.accountCurrentPassword = '';
    appState.examConfig.examType = result.target_exam;
    appState.dashboardLoaded = false;
    appState.dashboard = null;
    localStorage.setItem('np_user', JSON.stringify(appState.currentUser));
    showToast('Profile and account updated.');
    render();
  } catch (err) {
    showToast(err.message || 'Unable to save profile.');
    saveButton.disabled = false;
    saveButton.textContent = 'Save Profile & Account';
  }
}

function showAccountDeleteConfirmation() {
  const currentPassword = document.getElementById('currentPassword').value;
  if (!currentPassword) {
    showToast('Enter your current password before deleting your account.');
    document.getElementById('currentPassword').focus();
    return;
  }
  document.getElementById('deleteAccountConfirmation').hidden = false;
  document.getElementById('deleteConfirmationText').focus();
}

async function handleAccountDelete() {
  const currentPassword = document.getElementById('currentPassword').value;
  const confirmation = document.getElementById('deleteConfirmationText').value;
  if (!currentPassword) {
    showToast('Enter your current password before deleting your account.');
    document.getElementById('currentPassword').focus();
    return;
  }
  if (confirmation !== 'DELETE') return;

  const button = document.getElementById('confirmAccountDeleteBtn');
  button.disabled = true;
  button.textContent = 'Deleting account...';
  try {
    const result = await Api.deleteAccount(appState.currentUser.user_id, currentPassword);
    if (!result || !result.success) {
      throw new Error((result && result.error) || 'Unable to delete account.');
    }
    clearInterval(appState.timerInterval);
    localStorage.removeItem('np_user');
    appState.currentUser = null;
    appState.accountProfile = null;
    appState.accountCurrentPassword = '';
    appState.activeExamData = [];
    appState.examAnswers = {};
    appState.submitted = {};
    appState.dashboard = null;
    appState.dashboardLoaded = false;
    appState.dashboardLoading = false;
    appState.dashboardError = '';
    appState.profileLoading = false;
    appState.history = [];
    authMode = 'login';
    setView('auth');
    showToast('Account and all associated exam history deleted.');
  } catch (err) {
    showToast(err.message || 'Unable to delete account.');
    button.disabled = false;
    button.textContent = 'Delete Account Permanently';
  }
}

// ===== Exam Configurator =====
function renderConfig() {
  const cfg = appState.examConfig;
  main.innerHTML = `
    <div class="card exam-config">
      <h1 class="auth-title" style="text-align:center;">Configure Exam</h1>
      <p class="auth-sub" style="text-align:center;">Choose your practice settings.</p>

      <div class="config-row">
        <label class="form-label">Exam Type</label>
        <div class="radio-group" id="examTypeGroup">
          ${['NCLEX-RN','Prometric'].map(t => `
            <label class="radio-option ${cfg.examType===t?'selected':''}" data-val="${t}">
              <input type="radio" name="examType" value="${t}" ${cfg.examType===t?'checked':''} />
              <span>${t === 'NCLEX-RN' ? 'NCLEX-RN' : 'Prometric (Middle East)'}</span>
            </label>`).join('')}
        </div>
      </div>

      <div class="config-row">
        <label class="form-label">Mode</label>
        <div class="radio-group" id="modeGroup">
          ${[['tutor','Tutor Mode (immediate feedback)'],['mock','Timed Mock Exam (answers hidden until end)']].map(([v,l]) => `
            <label class="radio-option ${appState.examMode===v?'selected':''}" data-val="${v}">
              <input type="radio" name="mode" value="${v}" ${appState.examMode===v?'checked':''} />
              <span>${l}</span>
            </label>`).join('')}
        </div>
      </div>

      <div class="config-row">
        <label class="form-label" for="count">Number of Questions</label>
        <select class="form-select" id="count">
          ${[5,10,15,25,50,75].map(n => `<option value="${n}" ${cfg.count===n?'selected':''}>${n} questions</option>`).join('')}
        </select>
      </div>

      <div class="config-row">
        <label class="form-label" for="category">Subject Category (optional)</label>
        <select class="form-select" id="category">
          <option value="">All Categories</option>
          ${appState.categories.filter(c=>c!=='All').map(c => `<option value="${c}" ${cfg.category===c?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>

      <div style="display:flex;gap:12px;margin-top:24px;">
        <button class="btn btn-secondary" id="backDash" style="flex:1;">Back</button>
        <button class="btn btn-primary" id="beginExam" style="flex:2;">Begin Exam</button>
      </div>
    </div>`;
  // wire radio groups
  document.querySelectorAll('#examTypeGroup .radio-option').forEach(el => {
    el.onclick = () => {
      document.querySelectorAll('#examTypeGroup .radio-option').forEach(x=>x.classList.remove('selected'));
      el.classList.add('selected');
      el.querySelector('input').checked = true;
      appState.examConfig.examType = el.dataset.val;
      loadCategories(appState.examConfig.examType);
    };
  });
  // load categories for current exam type
  loadCategories(cfg.examType);
  document.querySelectorAll('#modeGroup .radio-option').forEach(el => {
    el.onclick = () => {
      document.querySelectorAll('#modeGroup .radio-option').forEach(x=>x.classList.remove('selected'));
      el.classList.add('selected');
      el.querySelector('input').checked = true;
      appState.examMode = el.dataset.val;
    };
  });
  document.getElementById('backDash').onclick = () => setView('dashboard');
  document.getElementById('beginExam').onclick = beginExam;
}

async function loadCategories(examType) {
  try {
    const res = await Api.getCategories(examType);
    if (res && res.success) {
      const cats = res.categories || [];
      appState.categories = ['All', ...cats];
      const sel = document.getElementById('category');
      if (sel) {
        const current = sel.value;
        sel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${escapeHtml(c)}" ${current===c?'selected':''}>${escapeHtml(c)}</option>`).join('');
      }
    } else if (appState.categories.length <= 1) {
      appState.categories = ['All', 'Pharmacological Therapies', 'Infection Prevention & Control'];
      const sel = document.getElementById('category');
      if (sel) {
        const cats = appState.categories.slice(1);
        const current = sel.value;
        sel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${escapeHtml(c)}" ${current===c?'selected':''}>${escapeHtml(c)}</option>`).join('');
      }
    }
  } catch (e) {
    if (appState.categories.length <= 1) {
      appState.categories = ['All', 'Pharmacological Therapies', 'Infection Prevention & Control'];
    }
  }
}

async function beginExam() {
  const cfg = appState.examConfig;
  cfg.count = parseInt(document.getElementById('count').value, 10);
  cfg.category = document.getElementById('category').value;
  setLoading('Fetching questions...');
  try {
    const res = await Api.getExam(cfg.examType, cfg.count, cfg.category);
    if (!res.success || !res.questions || !res.questions.length) {
      showToast('No questions available for this selection.');
      setView('config');
      return;
    }
    appState.activeExamData = res.questions;
    appState.currentIndex = 0;
    appState.examAnswers = {};
    appState.submitted = {};
    appState.lastResult = null;
    // timer for mock mode: ~1.5 min per question
    if (appState.examMode === 'mock') {
      appState.timeRemaining = appState.activeExamData.length * 90;
      startTimer();
    } else {
      appState.timeRemaining = 0;
    }
    setView('exam');
  } catch (err) {
    showErrorState(err.message, beginExam);
  }
}

// ===== Timer =====
function startTimer() {
  clearInterval(appState.timerInterval);
  appState.timerInterval = setInterval(() => {
    appState.timeRemaining--;
    if (appState.timeRemaining <= 0) {
      clearInterval(appState.timerInterval);
      appState.timeRemaining = 0;
      showToast('Time is up! Submitting exam...');
      submitMockExam();
      return;
    }
    const badge = document.getElementById('timerBadge');
    if (badge) {
      badge.textContent = formatTime(appState.timeRemaining);
      badge.classList.remove('warning','danger');
      if (appState.timeRemaining < 120) badge.classList.add('danger');
      else if (appState.timeRemaining < 300) badge.classList.add('warning');
    }
  }, 1000);
}

function exitExam() {
  if (!window.confirm('Exit this exam? Your current answers will be lost.')) return;
  clearInterval(appState.timerInterval);
  appState.activeExamData = [];
  appState.currentIndex = 0;
  appState.examAnswers = {};
  appState.submitted = {};
  appState.timeRemaining = 0;
  setView('dashboard');
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2,'0')}`;
}

// ===== Active Exam =====
function renderExam() {
  const q = appState.activeExamData[appState.currentIndex];
  if (!q) { setView('review'); return; }
  const isMock = appState.examMode === 'mock';
  const sata = !!q.is_ngn;
  const total = appState.activeExamData.length;
  const idx = appState.currentIndex;
  const userAns = appState.examAnswers[q.q_id];
  const graded = appState.submitted[q.q_id];
  const hasAnswer = (Array.isArray(userAns) ? userAns.length > 0 : userAns !== undefined && userAns !== null && userAns !== '');
  const nextDisabled = isMock ? !hasAnswer : !graded;

  let optionsHtml = '';
  if (sata) {
    // checkboxes
    const selected = Array.isArray(userAns) ? userAns : [];
    optionsHtml = `<p class="sata-hint">Select all that apply.</p><div class="options-list">` +
      q.options.map((opt, i) => {
        const letter = String.fromCharCode(65 + i);
        const isChecked = selected.includes(opt);
        let cls = 'option-btn';
        if (graded) {
          const correctArr = Array.isArray(graded.correct_answer) ? graded.correct_answer : [graded.correct_answer];
          if (correctArr.includes(opt)) cls += ' correct';
          else if (isChecked) cls += ' incorrect';
        } else if (isChecked) {
          cls += ' selected';
        }
        return `<label class="${cls}" data-opt="${escapeHtml(opt)}">
          <input type="checkbox" ${isChecked?'checked':''} ${graded?'disabled':''} style="width:18px;height:18px;accent-color:var(--primary-teal);" />
          <span class="option-letter">${letter}</span>
          <span>${escapeHtml(opt)}</span>
        </label>`;
      }).join('') + `</div>`;
  } else {
    optionsHtml = `<div class="options-list">` +
      q.options.map((opt, i) => {
        const letter = String.fromCharCode(65 + i);
        let cls = 'option-btn';
        if (graded) {
          if (opt === graded.correct_answer) cls += ' correct';
          else if (opt === userAns) cls += ' incorrect';
        } else if (opt === userAns) {
          cls += ' selected';
        }
        const disabled = graded ? 'disabled' : '';
        return `<button class="${cls}" data-opt="${escapeHtml(opt)}" ${disabled} role="radio" aria-checked="${opt === userAns}">${''}<span class="option-letter">${letter}</span><span>${escapeHtml(opt)}</span></button>`;
      }).join('') + `</div>`;
  }

  let rationaleHtml = '';
  if (graded) {
    const rc = graded.is_correct ? 'correct' : 'incorrect';
    rationaleHtml = `
      <div class="rationale-box ${rc}">
        <div class="rationale-title">${graded.is_correct ? 'Correct' : 'Incorrect'}</div>
        <div class="rationale-text">${escapeHtml(graded.rationale || '')}</div>
        <div style="margin-top:8px;font-size:13px;color:var(--text-muted);">Correct answer: <strong>${escapeHtml(Array.isArray(graded.correct_answer)?graded.correct_answer.join(', '):graded.correct_answer)}</strong></div>
      </div>`;
  }

  const timerHtml = isMock ? `<div class="timer-badge" id="timerBadge">${formatTime(appState.timeRemaining)}</div>` : '';

  main.innerHTML = `
    <div class="exam-header">
      <div>
        <span class="q-category">${escapeHtml(q.category || q.exam_type)}</span>
        <span style="color:var(--text-muted);font-size:13px;margin-left:8px;">${escapeHtml(q.exam_type)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        ${timerHtml}
        <button class="btn btn-secondary" id="exitExamBtn" type="button">Exit Exam</button>
      </div>
    </div>
    <div class="question-card">
      <div class="q-progress">Question ${idx+1} of ${total}</div>
      <div class="q-text">${escapeHtml(q.question_text)}</div>
      ${isMock ? '<p class="sata-hint">Your answer is saved automatically. Select Finish Exam on the last question to submit.</p>' : ''}
      ${optionsHtml}
      ${rationaleHtml}
      <div style="display:flex;justify-content:space-between;margin-top:24px;gap:12px;">
        <button class="btn btn-secondary" id="prevBtn" ${idx===0?'disabled':''}>Previous</button>
        <div style="display:flex;gap:12px;">
          ${isMock ? '' : (graded ? '' : `<button class="btn btn-primary" id="submitQBtn" ${userAns===undefined||userAns===null||(Array.isArray(userAns)&&!userAns.length)?'disabled':''}>Submit Answer</button>`)}
          ${idx < total-1 ? `<button class="btn btn-secondary" id="nextBtn" ${nextDisabled?'disabled':''}>Next</button>` : `<button class="btn btn-success" id="finishBtn">${isMock?'Finish Exam':'Finish'}</button>`}
        </div>
      </div>
    </div>`;

  // wire options
  if (!graded) {
    if (sata) {
      document.querySelectorAll('.option-btn').forEach(btn => {
        const cb = btn.querySelector('input');
        cb.onchange = () => {
          toggleSata(q.q_id, btn.dataset.opt, cb.checked, isMock);
          btn.classList.toggle('selected', cb.checked);
        };
      });
    } else {
      document.querySelectorAll('.option-btn').forEach(btn => {
        btn.onclick = () => {
          appState.examAnswers[q.q_id] = btn.dataset.opt;
          document.querySelectorAll('.option-btn').forEach(b=>b.classList.remove('selected'));
          btn.classList.add('selected');
          const sb = document.getElementById('submitQBtn');
          if (sb) sb.disabled = false;
          const nb = document.getElementById('nextBtn');
          if (nb) nb.disabled = !isMock; // tutor answers must be graded before advancing
        };
      });
    }
  }

  document.getElementById('exitExamBtn').onclick = exitExam;

  // submit question (tutor mode)
  const sq = document.getElementById('submitQBtn');
  if (sq) sq.onclick = () => submitSingleQuestion(q);

  // navigation
  const prev = document.getElementById('prevBtn');
  if (prev) prev.onclick = () => { appState.currentIndex = Math.max(0, appState.currentIndex-1); renderExam(); };
  const next = document.getElementById('nextBtn');
  if (next) next.onclick = () => { appState.currentIndex = Math.min(total-1, appState.currentIndex+1); renderExam(); };
  const finish = document.getElementById('finishBtn');
  if (finish) finish.onclick = () => {
    if (isMock) submitMockExam();
    else submitTutorExam();
  };
}

function toggleSata(qId, opt, checked, isMock) {
  if (!Array.isArray(appState.examAnswers[qId])) appState.examAnswers[qId] = [];
  const arr = appState.examAnswers[qId];
  if (checked) { if (!arr.includes(opt)) arr.push(opt); }
  else { const i = arr.indexOf(opt); if (i>=0) arr.splice(i,1); }
  const hasAnswer = arr.length > 0;
  const sb = document.getElementById('submitQBtn');
  if (sb) sb.disabled = !hasAnswer;
  const nb = document.getElementById('nextBtn');
  if (nb) nb.disabled = isMock ? !hasAnswer : true;
}

async function submitSingleQuestion(q) {
  const ans = appState.examAnswers[q.q_id];
  setLoading('Grading...');
  try {
    const res = await Api.gradeQuestion(q.q_id, ans);
    if (res.success) {
      appState.submitted[q.q_id] = res;
      // tutor mode: ensure answer recorded
      renderExam();
    } else {
      showToast(res.error || 'Grading failed.');
      renderExam();
    }
  } catch (err) {
    showErrorState(err.message, () => submitSingleQuestion(q));
  }
}

async function submitMockExam() {
  clearInterval(appState.timerInterval);
  setLoading('Submitting exam and calculating score...');
  const answers = appState.activeExamData.map(q => ({
    q_id: q.q_id,
    user_answer: appState.examAnswers[q.q_id] !== undefined ? appState.examAnswers[q.q_id] : null
  }));
  try {
    const res = await Api.submitExam(appState.currentUser.user_id, 'mock', answers, appState.examConfig.examType);
    if (res.success) {
      appState.lastResult = res;
      appState.history.push({
        mode: 'Mock Exam',
        examType: appState.examConfig.examType,
        score: res.score
      });
      appState.dashboardLoaded = false;
      await loadMockReview();
    } else {
      showToast(res.error || 'Submit failed.');
      renderExam();
    }
  } catch (err) {
    showErrorState(err.message, submitMockExam);
  }
}

async function loadMockReview() {
  setLoading('Loading correct answers and rationales...');
  try {
    const results = {};
    const questions = appState.activeExamData;
    for (let i = 0; i < questions.length; i += 5) {
      const batch = questions.slice(i, i + 5);
      const graded = await Promise.all(batch.map(q =>
        Api.gradeQuestion(q.q_id, appState.examAnswers[q.q_id] !== undefined ? appState.examAnswers[q.q_id] : null)
      ));
      graded.forEach((result, index) => {
        if (!result || !result.success) {
          throw new Error((result && result.error) || 'Unable to load exam review.');
        }
        results[batch[index].q_id] = result;
      });
    }
    appState.submitted = results;
    setView('review');
  } catch (err) {
    showErrorState(err.message, loadMockReview);
  }
}

async function submitTutorExam() {
  setLoading('Saving session...');
  const answers = appState.activeExamData.map(q => ({
    q_id: q.q_id,
    user_answer: appState.examAnswers[q.q_id] !== undefined ? appState.examAnswers[q.q_id] : null
  }));
  try {
    const res = await Api.submitExam(appState.currentUser.user_id, 'tutor', answers, appState.examConfig.examType);
    if (res.success) {
      appState.lastResult = res;
      appState.history.push({
        mode: 'Tutor Mode',
        examType: appState.examConfig.examType,
        score: res.score
      });
      appState.dashboardLoaded = false;
    }
  } catch (err) {
    // non-fatal: still show review
  }
  appState.currentIndex = 0;
  setView('review');
}

// ===== Review =====
function renderReview() {
  const isMock = appState.examMode === 'mock';
  if (isMock && appState.lastResult) {
    const r = appState.lastResult;
    main.innerHTML = `
      <div class="card">
        <div class="review-summary">
          <div class="score-big">${r.score}%</div>
          <div class="score-label">${r.correct} of ${r.total} correct</div>
          <p style="margin-top:12px;color:var(--text-muted);">Session ID: ${escapeHtml(r.session_id)}</p>
        </div>
        ${appState.activeExamData.map((q, i) => {
          const g = appState.submitted[q.q_id];
          const userAnswer = appState.examAnswers[q.q_id];
          const correctAnswerText = g && Array.isArray(g.correct_answer)
            ? g.correct_answer.join(', ')
            : g ? g.correct_answer : '';
          const resultTitle = userAnswer === undefined || userAnswer === null || (Array.isArray(userAnswer) && !userAnswer.length)
            ? 'Unanswered'
            : g && g.is_correct ? 'Correct' : 'Incorrect';
          const correctOptions = new Set(g
            ? (Array.isArray(g.correct_answer) ? g.correct_answer : [g.correct_answer]).map(String)
            : []);
          const selectedOptions = new Set(userAnswer === undefined || userAnswer === null
            ? []
            : (Array.isArray(userAnswer) ? userAnswer : [userAnswer]).map(String));
          return `
            <div class="question-card exam-review-question ${g && g.is_correct ? 'is-correct' : 'is-incorrect'}">
              <div class="q-progress">Question ${i+1}</div>
              <div class="q-category">${escapeHtml(q.category || q.exam_type)}</div>
              <div class="q-text">${escapeHtml(q.question_text)}</div>
              <div class="exam-review-status ${g && g.is_correct ? 'is-correct' : 'is-incorrect'}">${resultTitle}</div>
              <div class="exam-review-options">
                ${q.options.map((opt, optionIndex) => {
                  const option = String(opt);
                  const isCorrectOption = correctOptions.has(option);
                  const isSelectedOption = selectedOptions.has(option);
                  const optionClass = isCorrectOption ? 'is-correct' : (isSelectedOption ? 'is-incorrect' : '');
                  const label = isCorrectOption ? 'Correct answer' : (isSelectedOption ? 'Your answer' : '');
                  return `<div class="exam-review-option ${optionClass}">
                    <span class="option-letter">${String.fromCharCode(65 + optionIndex)}</span>
                    <span class="exam-review-option-text">${escapeHtml(option)}</span>
                    ${label ? `<span class="exam-review-option-label">${label}</span>` : ''}
                  </div>`;
                }).join('')}
              </div>
              <div class="exam-review-rationale">
                <div class="exam-review-correct-answer">Correct answer: <strong>${escapeHtml(correctAnswerText)}</strong></div>
                <div class="exam-review-rationale-title">Rationale</div>
                <div class="rationale-text">${escapeHtml(g ? g.rationale || '' : '')}</div>
              </div>
            </div>`;
        }).join('')}
        <div style="text-align:center;margin-top:20px;">
          <button class="btn btn-primary" id="backDash2">Back to Dashboard</button>
        </div>
      </div>`;
    document.getElementById('backDash2').onclick = () => { appState.activeExamData=[]; appState.examAnswers={}; appState.submitted={}; setView('dashboard'); };
    return;
  }
  // Tutor review: show all questions with answers/rationales
  main.innerHTML = `
    <div class="card">
      <h1 class="auth-title">Review</h1>
      <p class="auth-sub">Your tutor-mode session results.</p>
      ${appState.lastResult ? `<div class="review-summary"><div class="score-big">${appState.lastResult.score}%</div><div class="score-label">${appState.lastResult.correct} of ${appState.lastResult.total} correct</div></div>` : ''}
      ${appState.activeExamData.map((q, i) => {
        const g = appState.submitted[q.q_id];
        return `
        <div class="question-card" style="margin-bottom:16px;">
          <div class="q-progress">Question ${i+1}</div>
          <div class="q-category">${escapeHtml(q.category)}</div>
          <div class="q-text">${escapeHtml(q.question_text)}</div>
          ${g ? `
            <div class="rationale-box ${g.is_correct?'correct':'incorrect'}">
              <div class="rationale-title">${g.is_correct?'Correct':'Incorrect'}</div>
              <div class="rationale-text">${escapeHtml(g.rationale||'')}</div>
              <div style="margin-top:8px;font-size:13px;">Correct: <strong>${escapeHtml(Array.isArray(g.correct_answer)?g.correct_answer.join(', '):g.correct_answer)}</strong></div>
            </div>` : `<p style="color:var(--text-muted);font-size:13px;">Not submitted.</p>`}
        </div>`;
      }).join('')}
      <div style="text-align:center;margin-top:20px;">
        <button class="btn btn-primary" id="backDash3">Back to Dashboard</button>
      </div>
    </div>`;
  document.getElementById('backDash3').onclick = () => { appState.activeExamData=[]; appState.examAnswers={}; appState.submitted={}; setView('dashboard'); };
}

// ===== Init =====
(function init() {
  const saved = localStorage.getItem('np_user');
  if (saved) {
    try { appState.currentUser = JSON.parse(saved); setView('dashboard'); return; } catch(e){}
  }
  setView('auth');
})();
