// ===== App State =====
const EXAM_OPTIONS = [
  'NCLEX-RN',
  'Prometric',
  'Licence Exam Preparation',
  'IBN SINA Trust Nursing Exam'
];

const appState = {
  currentUser: null,
  currentView: 'landing',
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
  categoryStrengthExpanded: false,
  accountProfile: null,
  profileLoading: false,
  accountCurrentPassword: '',
  history: []
};

// ===== DOM refs =====
const main = document.getElementById('main');
const headerRight = document.getElementById('headerRight');
const toast = document.getElementById('toast');

function closeProfileMenu(returnFocus) {
  const profileBtn = document.getElementById('profileBtn');
  const profileMenu = document.getElementById('profileMenu');
  if (!profileBtn || !profileMenu) return;
  profileMenu.hidden = true;
  profileBtn.setAttribute('aria-expanded', 'false');
  if (returnFocus) profileBtn.focus();
}

document.addEventListener('click', event => {
  if (!headerRight.contains(event.target)) closeProfileMenu(false);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeProfileMenu(true);
});

// ===== Landing background =====
function setLandingParticleEffect(enabled) {
  const canvas = document.getElementById('particleCanvas');
  if (!canvas) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) enabled = false;

  if (!enabled) {
    canvas.classList.remove('is-active');
    if (canvas._particleEffect && canvas._particleEffect.running) {
      canvas._particleEffect.running = false;
      canvas._particleEffect.stop();
    }
    return;
  }

  const context = canvas.getContext('2d');
  if (!context) return;

  if (!canvas._particleEffect) {
    const pointer = { x: -1000, y: -1000 };
    const particles = [];
    let animationFrame = 0;
    let width = 0;
    let height = 0;
    const onPointerMove = event => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    };
    const onPointerLeave = () => {
      pointer.x = -1000;
      pointer.y = -1000;
    };

    const resize = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const count = Math.min(100, Math.max(30, Math.floor(width * height / 12000)));
      particles.length = 0;
      for (let i = 0; i < count; i += 1) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.35,
          vy: (Math.random() - 0.5) * 0.35,
          radius: Math.random() * 1.6 + 1
        });
      }
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      particles.forEach((particle, index) => {
        const dx = pointer.x - particle.x;
        const dy = pointer.y - particle.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 150 && distance > 0) {
          const influence = (1 - distance / 150) * 0.012 / distance;
          particle.vx += dx * influence;
          particle.vy += dy * influence;
        }

        particle.vx *= 0.985;
        particle.vy *= 0.985;
        particle.x += particle.vx;
        particle.y += particle.vy;
        if (particle.x < -8) particle.x = width + 8;
        if (particle.x > width + 8) particle.x = -8;
        if (particle.y < -8) particle.y = height + 8;
        if (particle.y > height + 8) particle.y = -8;

        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fillStyle = 'rgba(0, 106, 78, 0.38)';
        context.fill();

        for (let otherIndex = index + 1; otherIndex < particles.length; otherIndex += 1) {
          const other = particles[otherIndex];
          const lineX = particle.x - other.x;
          const lineY = particle.y - other.y;
          const lineDistance = Math.hypot(lineX, lineY);
          if (lineDistance < 115) {
            context.beginPath();
            context.moveTo(particle.x, particle.y);
            context.lineTo(other.x, other.y);
            context.strokeStyle = `rgba(0, 106, 78, ${(1 - lineDistance / 115) * 0.12})`;
            context.stroke();
          }
        }
      });
      animationFrame = window.requestAnimationFrame(draw);
    };

    canvas._particleEffect = {
      start() {
        resize();
        window.addEventListener('resize', resize);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerleave', onPointerLeave);
        animationFrame = window.requestAnimationFrame(draw);
      },
      stop() {
        window.cancelAnimationFrame(animationFrame);
        window.removeEventListener('resize', resize);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerleave', onPointerLeave);
        context.clearRect(0, 0, width, height);
      }
    };
  }

  canvas.classList.toggle('is-active', enabled);
  if (enabled && !canvas._particleEffect.running) {
    canvas._particleEffect.running = true;
    canvas._particleEffect.start();
  } else if (!enabled && canvas._particleEffect.running) {
    canvas._particleEffect.running = false;
    canvas._particleEffect.stop();
  }
}

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

function showLogoPreloader(label) {
  const overlay = document.createElement('div');
  overlay.className = 'logo-preloader';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.dataset.startedAt = String(Date.now());

  const mark = document.createElement('div');
  mark.className = 'logo-preloader-mark';
  const logo = document.createElement('img');
  logo.src = 'assets/images/android-chrome-192x192.png';
  logo.alt = '';
  mark.appendChild(logo);

  const message = document.createElement('p');
  message.className = 'logo-preloader-label';
  message.textContent = label;
  overlay.append(mark, message);
  document.body.appendChild(overlay);

  let finishPromise;
  return {
    finish() {
      if (!finishPromise) {
        finishPromise = (async () => {
          const elapsed = Date.now() - Number(overlay.dataset.startedAt);
          if (elapsed < 1500) {
            await new Promise(resolve => setTimeout(resolve, 1500 - elapsed));
          }
          overlay.classList.add('is-hiding');
          await new Promise(resolve => setTimeout(resolve, 200));
          overlay.remove();
        })();
      }
      return finishPromise;
    }
  };
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function profileIconSvg() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="4"/></svg>';
}

function logoutIconSvg() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>';
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
  main.innerHTML = `
    <div class="loading-wrap loading-wrap--page">
      <div class="logo-preloader-mark" aria-hidden="true" style="width:80px;height:80px;">
        <img src="assets/images/android-chrome-192x192.png" alt="" />
      </div>
      <p class="logo-preloader-label">${escapeHtml(html || 'Loading...')}</p>
    </div>
  `;
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
  setLandingParticleEffect(appState.currentView === 'landing');
  updateHeader();
  ensureFloatingControls();
  switch (appState.currentView) {
    case 'landing': renderLanding(); break;
    case 'auth': renderAuth(); break;
    case 'dashboard': renderDashboard(); break;
    case 'profile': renderProfile(); break;
    case 'config': renderConfig(); break;
    case 'exam': renderExam(); break;
    case 'review': renderReview(); break;
    default: renderLanding();
  }
}

function ensureFloatingControls() {
  let timer = document.getElementById('floatingTimer');
  if (!timer && appState.currentView === 'exam' && appState.examMode === 'mock') {
    timer = document.createElement('div');
    timer.id = 'floatingTimer';
    timer.className = 'floating-timer';
    timer.textContent = formatTime(appState.timeRemaining || 0);
    document.body.appendChild(timer);
  }
  if (timer && (appState.currentView !== 'exam' || appState.examMode !== 'mock')) {
    timer.remove();
  }

  let backBtn = document.getElementById('backToTopBtn');
  if (!backBtn) {
    backBtn = document.createElement('button');
    backBtn.id = 'backToTopBtn';
    backBtn.className = 'back-to-top';
    backBtn.type = 'button';
    backBtn.setAttribute('aria-label', 'Back to top');
    backBtn.textContent = '↑';
    backBtn.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
    document.body.appendChild(backBtn);
  }
  updateBackToTopVisibility();

  refreshFloatingTimer();
}

function updateBackToTopVisibility() {
  const backBtn = document.getElementById('backToTopBtn');
  if (!backBtn) return;
  const shouldShowBackToTop = window.scrollY > 180 && appState.currentView !== 'landing';
  backBtn.style.display = shouldShowBackToTop ? 'flex' : 'none';
}

function refreshFloatingTimer() {
  const timerEl = document.getElementById('floatingTimer');
  if (!timerEl) return;
  timerEl.textContent = formatTime(appState.timeRemaining || 0);
  timerEl.classList.toggle('warning', appState.timeRemaining > 0 && appState.timeRemaining < 300);
  timerEl.classList.toggle('danger', appState.timeRemaining > 0 && appState.timeRemaining < 120);
}

function updateHeader() {
  if (appState.currentUser) {
    const profileBtnMarkup = appState.currentView !== 'exam'
      ? `<div class="profile-menu-wrap">
          <button class="icon-btn" id="profileBtn" type="button" aria-label="Profile and account" title="Profile & Account" aria-haspopup="true" aria-expanded="false" aria-controls="profileMenu">${profileIconSvg()}</button>
          <div class="profile-menu" id="profileMenu" role="menu" aria-labelledby="profileBtn" hidden>
            <button class="profile-menu-item" id="profileMenuAccount" type="button" role="menuitem">Profile &amp; Account</button>
            <button class="profile-menu-item" id="profileMenuLogout" type="button" role="menuitem">${logoutIconSvg()}<span>Log out</span></button>
          </div>
        </div>`
      : '';
    headerRight.innerHTML = '<span class="user-chip">' + escapeHtml(appState.currentUser.email) + '</span>' + profileBtnMarkup;
    const profileBtn = document.getElementById('profileBtn');
    if (profileBtn) profileBtn.onclick = () => {
      const profileMenu = document.getElementById('profileMenu');
      const isExpanded = profileBtn.getAttribute('aria-expanded') === 'true';
      profileBtn.setAttribute('aria-expanded', String(!isExpanded));
      profileMenu.hidden = isExpanded;
    };
    const profileMenuAccount = document.getElementById('profileMenuAccount');
    if (profileMenuAccount) profileMenuAccount.onclick = () => {
      appState.accountProfile = null;
      appState.accountCurrentPassword = '';
      setView('profile');
    };
    const profileMenuLogout = document.getElementById('profileMenuLogout');
    if (profileMenuLogout) profileMenuLogout.onclick = logout;
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

// ===== Landing Screen =====
function renderLanding() {
  main.innerHTML = `
    <div class="landing-wrap">
      <div class="landing-card card">
        <div class="landing-badge">NursePrep Pro</div>
        <h1>Practice smarter for your nursing exam goals.</h1>
        <p>Train with NCLEX, Prometric, Licence, and IBN SINA practice sets backed by adaptive review and score tracking.</p>
        <div class="landing-actions">
          <button class="btn btn-primary" id="landingRegisterBtn">Register</button>
          <button class="btn btn-secondary" id="landingLoginBtn">Login</button>
        </div>
      </div>
    </div>`;

  document.getElementById('landingRegisterBtn').onclick = () => {
    authMode = 'register';
    setView('auth');
  };
  document.getElementById('landingLoginBtn').onclick = () => {
    authMode = 'login';
    setView('auth');
  };
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
              ${EXAM_OPTIONS.map(exam => `<option value="${exam}">${exam}</option>`).join('')}
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
  const preloader = authMode === 'login' ? showLogoPreloader('Signing in...') : null;
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
    if (preloader) await preloader.finish();
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

  // Score trend (last 10 sessions, oldest to newest)
  const orderedSessions = sessions
    .map((session, index) => ({ session, index, date: parseSessionDate(session.timestamp) }))
    .sort((a, b) => {
      if (a.date && b.date) return b.date - a.date;
      if (a.date) return -1;
      if (b.date) return 1;
      return a.index - b.index;
    });
  const trend = orderedSessions.slice(-10).reverse();
  const maxScore = 100;
  const trendChart = trend.length ? (() => {
    const chartWidth = 600;
    const chartHeight = 240;
    const left = 42;
    const right = 16;
    const top = 16;
    const bottom = 198;
    const plotWidth = chartWidth - left - right;
    const plotHeight = bottom - top;
    const points = trend.map(({ session, date }, index) => {
      const score = Math.min(maxScore, Math.max(0, Number(session.score) || 0));
      const x = trend.length === 1 ? left + plotWidth / 2 : left + index * plotWidth / (trend.length - 1);
      const y = bottom - score / maxScore * plotHeight;
      const dateLabel = date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'N/A';
      const sessionLabel = session.mode === 'mock' ? 'Mock' : session.mode === 'tutor' ? 'Tutor' : session.mode || 'Exam';
      const tooltip = `${sessionLabel} · ${score}%${date ? ' · ' + date.toLocaleString() : ''}`;
      const color = score >= 70 ? 'var(--success-green)' : (score >= 50 ? 'var(--warning-amber)' : 'var(--error-red)');
      return { x, y, score, dateLabel, tooltip, color };
    });
    const gridLines = [0, 25, 50, 75, 100].map(value => {
      const y = bottom - value / maxScore * plotHeight;
      return `<g class="trend-gridline">
        <line x1="${left}" y1="${y}" x2="${chartWidth - right}" y2="${y}"></line>
        <text x="${left - 8}" y="${y + 3}" text-anchor="end">${value}</text>
      </g>`;
    }).join('');
    const columns = points.map(point => {
      const height = bottom - point.y;
      return `<g>
        <title>${escapeHtml(point.tooltip)}</title>
        <rect class="trend-column" x="${point.x - 12}" y="${point.y}" width="24" height="${height}" rx="4" style="--trend-column-color:${point.color};"></rect>
        <text class="trend-point-label" x="${point.x}" y="${Math.max(top + 10, point.y - 8)}" text-anchor="middle">${point.score}%</text>
        <text class="trend-date-label" x="${point.x}" y="${bottom + 20}" text-anchor="middle">${escapeHtml(point.dateLabel)}</text>
      </g>`;
    }).join('');
    const linePoints = points.map(point => `${point.x},${point.y}`).join(' ');
    const markers = points.map(point => `<circle class="trend-line-marker" cx="${point.x}" cy="${point.y}" r="4"></circle>`).join('');
    return `<svg class="score-trend-svg" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="Recent exam scores shown as columns connected by a trend line">
      ${gridLines}
      ${columns}
      <polyline class="trend-line" points="${linePoints}"></polyline>
      ${markers}
    </svg>`;
  })() : '<p style="color:var(--text-muted);font-size:13px;">No sessions yet. Start practicing to see your trend.</p>';

  // category strength cards
  const visibleCatStats = appState.categoryStrengthExpanded ? catStats : catStats.slice(0, 2);
  const catRows = catStats.length ? `<div class="category-strength-grid">${visibleCatStats.map(c => {
    const accuracy = Number(c.accuracy) || 0;
    const progress = Math.min(100, Math.max(0, accuracy));
    const color = catColor(accuracy);
    return `
      <article class="category-strength-card">
        <div class="category-strength-heading">
          <h3>${escapeHtml(c.category)}</h3>
        </div>
        <div class="category-strength-donut" role="img" aria-label="${escapeHtml(c.category)} accuracy ${Math.round(progress)}%" style="--category-progress:${progress}%;--category-color:${color};">
          <span>${Math.round(progress)}%</span>
        </div>
        <p class="category-strength-count">${c.correct}/${c.total} correct</p>
        <button class="btn btn-primary category-strength-practice" data-cat="${escapeHtml(c.category)}" data-practice type="button">Practice</button>
      </article>`;
  }).join('')}</div>${catStats.length > 2 ? `
    <button class="category-strength-toggle" id="toggleCategoryStrength" type="button" aria-expanded="${appState.categoryStrengthExpanded}">
      ${appState.categoryStrengthExpanded ? 'Show fewer categories' : `Show all ${catStats.length} categories`}
      <span class="category-strength-toggle-icon" aria-hidden="true">${appState.categoryStrengthExpanded ? '↑' : '↓'}</span>
    </button>` : ''}` : (loading ? '<p style="color:var(--text-muted);font-size:13px;">Loading...</p>' : '<p style="color:var(--text-muted);font-size:13px;">No category data yet.</p>');

  // weak categories (accuracy < 70 with at least 3 attempts)
  const weak = catStats.filter(c => c.total >= 3 && c.accuracy < 70);

  main.innerHTML = `
    <div class="card">
      <h1 style="font-size:22px;font-weight:700;margin-bottom:4px;">Hello, ${escapeHtml(u.email.split('@')[0])}</h1>
      <p style="color:var(--text-muted);margin-bottom:20px;">Target exam: <strong>${escapeHtml(u.target_exam)}</strong></p>
      ${loading ? `
      <div class="loading-wrap">
        <div class="logo-preloader-mark" aria-hidden="true" style="width:80px;height:80px;">
          <img src="assets/images/android-chrome-192x192.png" alt="" />
        </div>
        <p class="logo-preloader-label">Loading analytics...</p>
      </div>` : appState.dashboardError ? `
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
    <div class="score-trend-chart">
       ${trend.length ? (() => {
         const grades = trend.map(({ session }) => Math.min(100, Math.max(0, Number(session.score) || 0)));
         const total = grades.reduce((sum, value) => sum + value, 0);
         const average = grades.length ? Math.round(total / grades.length) : 0;
         const passCount = grades.filter(value => value >= 60).length;
         const borderlineCount = grades.filter(value => value >= 40 && value < 60).length;
         const needWorkCount = grades.length - passCount - borderlineCount;
         const passEnd = (passCount / grades.length) * 100;
         const borderlineEnd = ((passCount + borderlineCount) / grades.length) * 100;
         const counts = [passCount, borderlineCount, needWorkCount];
         const percentages = counts.map(count => Math.floor((count / grades.length) * 100));
         let remainingPercentage = 100 - percentages.reduce((sum, value) => sum + value, 0);
         counts
           .map((count, index) => ({ index, remainder: (count / grades.length) * 100 - percentages[index] }))
           .sort((a, b) => b.remainder - a.remainder)
           .slice(0, remainingPercentage)
           .forEach(({ index }) => { percentages[index] += 1; });
         const pieSegments = [
           { label: 'Pass', value: percentages[0], color: 'success' },
           { label: 'Borderline', value: percentages[1], color: 'warning' },
           { label: 'Need work', value: percentages[2], color: 'danger' }
         ];
         return `
           <div class="score-distribution">
             <div class="mini-donut" role="img" aria-label="Score distribution: Pass ${pieSegments[0].value}%, Borderline ${pieSegments[1].value}%, Need work ${pieSegments[2].value}%" style="--pass-end:${passEnd}%;--borderline-end:${borderlineEnd}%;">
               <div class="mini-donut-inner">
                 <strong>${average}%</strong>
                 <span>Avg score</span>
               </div>
             </div>
             <div class="mini-chart-legend">
               ${pieSegments.map(segment => `<div class="legend-item"><span class="legend-dot ${segment.color}"></span> ${segment.label} ${segment.value}%</div>`).join('')}
             </div>
           </div>
           <div class="score-trend-graph">
             ${trendChart}
           </div>
         `;
       })() : '<p style="color:var(--text-muted);font-size:13px;">No sessions yet. Start practicing to see your trend.</p>'}
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
      <div class="recent-sessions-table-wrap">
        <table class="recent-sessions-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Exam</th>
              <th scope="col">Session</th>
              <th scope="col">Score</th>
            </tr>
          </thead>
          <tbody>
       ${orderedSessions.slice(0, 10).map(({session: h, date}) => {
         const sessionLabel = h.mode === 'mock' ? 'Mock' : h.mode === 'tutor' ? 'Tutor' : h.mode || 'Exam';
         const score = Math.min(100, Math.max(0, Number(h.score) || 0));
         const color = score >= 70 ? 'var(--success-green)' : (score >= 50 ? 'var(--warning-amber)' : 'var(--error-red)');
         const examType = h.exam_type || u.target_exam;
         const dateLabel = date ? date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Date unavailable';
         return `<tr>
           <td>${escapeHtml(dateLabel)}</td>
           <td>${escapeHtml(examType)}</td>
           <td>${escapeHtml(sessionLabel)}</td>
           <td>
             <div class="session-score-cell">
               <div class="session-score-pie" role="img" aria-label="${score}% score" style="--session-score:${score}%;--session-score-color:${color};">
                 <span>${score}%</span>
               </div>
             </div>
           </td>
         </tr>`;
       }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}` : ''}`;

  const btn = document.getElementById('startExamBtn');
  if (btn) btn.onclick = () => setView('config');
  const retryBtn = document.getElementById('retryDashboardBtn');
  if (retryBtn) retryBtn.onclick = loadDashboardData;
  const categoryToggle = document.getElementById('toggleCategoryStrength');
  if (categoryToggle) {
    categoryToggle.onclick = () => {
      appState.categoryStrengthExpanded = !appState.categoryStrengthExpanded;
      renderDashboard();
    };
  }

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
  const profileUnlocked = !!appState.accountProfile;

  main.innerHTML = `
    <div class="card profile-card">
      <h1 class="auth-title">Profile &amp; Account</h1>
      <p class="auth-sub">Manage your profile details, target exam, and account actions.</p>
      <p class="profile-privacy-note">Your profile is stored in the app’s linked Google Sheet. Blood group, address, nursing college, and birthday are optional; only share what you’re comfortable providing.</p>
      <form id="profileForm">
        <div class="form-group">
          <label class="form-label" for="currentPassword">Current password${profileUnlocked ? ' (required for password changes and account actions)' : ''}</label>
          <div class="password-input-wrap">
            <input class="form-input" type="password" id="currentPassword" autocomplete="current-password" value="${escapeHtml(appState.accountCurrentPassword)}" />
            <button class="password-toggle" type="button" id="toggleCurrentPassword" aria-label="Show current password" aria-pressed="false">Show</button>
          </div>
          <small class="profile-help">${profileUnlocked ? 'Only needed for password updates, session clear, and account deletion.' : 'Enter your current password to unlock your saved profile details.'}</small>
        </div>
        ${profileUnlocked ? `
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
                ${EXAM_OPTIONS.map(exam => `<option value="${exam}" ${appState.currentUser.target_exam === exam ? 'selected' : ''}>${exam}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="address">Address</label>
            <textarea class="form-input profile-textarea" id="address" name="address">${escapeHtml(profile.address || '')}</textarea>
          </div>

          <h2 class="section-title profile-section-title">Session history</h2>
          <div class="profile-grid" style="grid-template-columns:1fr;">
            <div class="form-group">
              <button class="btn btn-secondary btn-block" type="button" id="clearSessionsBtn">Clear all recent session history</button>
              <small class="profile-help">This removes your saved exam history and progress. Requires your current password.</small>
            </div>
          </div>

          <h2 class="section-title profile-section-title">Change password (optional)</h2>
          <div class="profile-grid">
            <div class="form-group">
              <label class="form-label" for="newPassword">New password</label>
              <div class="password-input-wrap">
                <input class="form-input" type="password" id="newPassword" autocomplete="new-password" minlength="8" />
                <button class="password-toggle" type="button" id="toggleNewPassword" aria-label="Show new password" aria-pressed="false">Show</button>
              </div>
              <small class="profile-help">Leave blank to keep your current password. Requires the current password to apply.</small>
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
            ${appState.profileLoading ? '<span class="spinner"></span> Unlocking profile...' : 'Unlock profile'}
          </button>
        `}
        <button class="btn btn-secondary btn-block profile-back-btn" type="button" id="profileBackBtn">Back to Dashboard</button>
        ${profileUnlocked ? '<button class="btn btn-secondary btn-block" type="button" id="logoutFromProfileBtn">Log out</button>' : ''}
      </form>
    </div>`;

  document.getElementById('profileBackBtn').onclick = () => {
    appState.accountProfile = null;
    appState.accountCurrentPassword = '';
    setView('dashboard');
  };
  const loadButton = document.getElementById('loadProfileBtn');
  if (loadButton) loadButton.onclick = loadProfile;
  const logoutFromProfileBtn = document.getElementById('logoutFromProfileBtn');
  if (logoutFromProfileBtn) logoutFromProfileBtn.onclick = logout;
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
  if (profileUnlocked) {
    form.onsubmit = handleProfileSave;
    document.getElementById('deleteAccountBtn').onclick = showAccountDeleteConfirmation;
    document.getElementById('clearSessionsBtn').onclick = clearSessionHistory;
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
  const enteredPassword = document.getElementById('currentPassword') ? document.getElementById('currentPassword').value : '';
  if (!enteredPassword) {
    showToast('Enter your current password to unlock your profile.');
    const passwordInput = document.getElementById('currentPassword');
    if (passwordInput) passwordInput.focus();
    return;
  }

  appState.accountCurrentPassword = enteredPassword;
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
    appState.accountProfile = null;
    showToast(err.message || 'Unable to load profile.');
  } finally {
    appState.profileLoading = false;
    renderProfile();
  }
}

async function clearSessionHistory() {
  const currentPassword = document.getElementById('currentPassword') ? document.getElementById('currentPassword').value : '';
  if (!currentPassword) {
    showToast('Enter your current password to clear recent sessions.');
    const pwd = document.getElementById('currentPassword');
    if (pwd) pwd.focus();
    return;
  }

  if (!window.confirm('Clear your saved exam session history and progress? This cannot be undone.')) return;

  try {
    const result = await Api.clearSessions(appState.currentUser.user_id, currentPassword);
    if (!result || !result.success) {
      throw new Error((result && result.error) || 'Unable to clear sessions.');
    }
    appState.dashboard = null;
    appState.dashboardLoaded = false;
    appState.dashboardLoading = false;
    appState.history = [];
    appState.accountProfile = appState.accountProfile || {};
    showToast('Session history cleared.');
    loadDashboardData();
    renderProfile();
  } catch (err) {
    showToast(err.message || 'Unable to clear sessions.');
  }
}

async function handleProfileSave(event) {
  event.preventDefault();
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  if (newPassword && !currentPassword) {
    showToast('Enter your current password to update your password.');
    document.getElementById('currentPassword').focus();
    return;
  }
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
      currentPassword,
      document.getElementById('targetExamSetting').value,
      profile,
      newPassword
    );
    if (!result || !result.success) {
      throw new Error((result && result.error) || 'Unable to save profile.');
    }
    appState.accountProfile = result.profile || profile;
    appState.currentUser.target_exam = result.target_exam;
    appState.accountCurrentPassword = currentPassword;
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
          ${EXAM_OPTIONS.map(t => `
            <label class="radio-option ${cfg.examType===t?'selected':''}" data-val="${t}">
              <input type="radio" name="examType" value="${t}" ${cfg.examType===t?'checked':''} />
              <span>${t}</span>
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
      refreshFloatingTimer();
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
function normalizeOptionValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  return text
    .replace(/^[A-Za-z]\s*[\)\.\:\-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeSelectionSet(value) {
  const raw = Array.isArray(value) ? value : [value];
  const normalized = raw
    .flatMap(item => {
      if (item === null || item === undefined || item === '') return [];
      if (typeof item === 'string') {
        const cleaned = item.trim();
        if (!cleaned) return [];
        const parts = cleaned.split(/[\n,;|]/).map(p => p.trim()).filter(Boolean);
        return parts.length > 1 ? parts : [cleaned];
      }
      return [item];
    })
    .map(normalizeOptionValue)
    .filter(Boolean);

  return new Set(normalized);
}

function questionTypeOf(q) {
  if (!q) return 'best_answer';
  const rawType = String(q.question_type || '').trim().toLowerCase();
  if (rawType === 'true_false_matrix' || rawType === 'true_false' || rawType === 'matrix' || rawType === 'multi_select' || rawType === 'check_all_that_apply') return 'true_false_matrix';
  if (rawType === 'scenario_multi_select') return 'scenario_multi_select';
  if (rawType === 'scenario_best_answer') return 'scenario_best_answer';
  const answerText = q.correct_answer == null ? '' : String(q.correct_answer);
  const answerIsMatrix =
    (Array.isArray(q.correct_answer) && q.options && q.options.length >= 5) ||
    (typeof q.correct_answer === 'string' && q.options && q.options.length >= 5 && /[;,|\n]/.test(answerText));
  if (answerIsMatrix) return 'true_false_matrix';
  if (q.is_ngn) return 'scenario_best_answer';
  return 'best_answer';
}

function renderExam() {
  const q = appState.activeExamData[appState.currentIndex];
  if (!q) { setView('review'); return; }
  const isMock = appState.examMode === 'mock';
  const questionType = questionTypeOf(q);
  const isMatrix = questionType === 'true_false_matrix';
  const isMulti = questionType === 'scenario_multi_select' || questionType === 'multi_select';
  const total = appState.activeExamData.length;
  const idx = appState.currentIndex;
  const userAns = appState.examAnswers[q.q_id];
  const graded = appState.submitted[q.q_id];
  const hasAnswer = Array.isArray(userAns) ? userAns.length > 0 : userAns !== undefined && userAns !== null && userAns !== '';
  const nextDisabled = isMock ? !hasAnswer : !graded;

  let optionsHtml = '';
  const options = Array.isArray(q.options) ? q.options : [];
  if (isMatrix || isMulti) {
    const selected = Array.isArray(userAns) ? userAns : [];
    const selectedSet = new Set(selected.map(normalizeOptionValue).filter(Boolean));
    optionsHtml = `<p class="sata-hint">${isMatrix ? 'Select each option correctly.' : 'Select all that apply.'}</p><div class="options-list">` +
      options.map((opt, i) => {
        const label = typeof opt === 'string' ? opt : (opt && (opt.label || opt.text || opt.option || opt.value)) || '';
        const letter = String.fromCharCode(65 + i);
        const normalizedLabel = normalizeOptionValue(label);
        const isChecked = selectedSet.has(normalizedLabel);
        let cls = 'option-btn';
        if (graded) {
          const correctSet = normalizeSelectionSet(graded.correct_answer);
          if (correctSet.has(normalizedLabel)) cls += ' correct';
          else if (isChecked) cls += ' incorrect';
        } else if (isChecked) {
          cls += ' selected';
        }
        return `<label class="${cls}" data-opt="${escapeHtml(label)}">
          <input type="checkbox" ${isChecked?'checked':''} ${graded?'disabled':''} style="width:18px;height:18px;accent-color:var(--primary-teal);" />
          <span class="option-letter">${letter}</span>
          <span>${escapeHtml(label)}</span>
        </label>`;
      }).join('') + `</div>`;
  } else {
    optionsHtml = `<div class="options-list">` +
      options.map((opt, i) => {
        const label = typeof opt === 'string' ? opt : (opt && (opt.label || opt.text || opt.option || opt.value)) || '';
        const letter = String.fromCharCode(65 + i);
        let cls = 'option-btn';
        if (graded) {
          if (label === graded.correct_answer) cls += ' correct';
          else if (label === userAns) cls += ' incorrect';
        } else if (label === userAns) {
          cls += ' selected';
        }
        const disabled = graded ? 'disabled' : '';
        return `<button class="${cls}" data-opt="${escapeHtml(label)}" ${disabled} role="radio" aria-checked="${label === userAns}"><span class="option-letter">${letter}</span><span>${escapeHtml(label)}</span></button>`;
      }).join('') + `</div>`;
  }

  let rationaleHtml = '';
  if (graded) {
    const rc = graded.is_correct ? 'correct' : 'incorrect';
    rationaleHtml = `
      <div class="rationale-box ${rc}">
        <div class="rationale-title">${graded.is_correct ? 'Correct' : 'Incorrect'}</div>
        <div class="rationale-text">${escapeHtml(graded.rationale || '')}</div>
        <div style="margin-top:8px;font-size:13px;color:var(--text-muted);">Correct answer: <strong>${escapeHtml(Array.isArray(graded.correct_answer) ? graded.correct_answer.join(', ') : graded.correct_answer || '')}</strong></div>
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
          ${isMock ? '' : (graded ? '' : `<button class="btn btn-primary" id="submitQBtn" ${!hasAnswer ? 'disabled' : ''}>Submit Answer</button>`) }
          ${idx < total-1 ? `<button class="btn btn-secondary" id="nextBtn" ${nextDisabled?'disabled':''}>Next</button>` : `<button class="btn btn-success" id="finishBtn">${isMock?'Finish Exam':'Finish'}</button>`}
        </div>
      </div>
    </div>`;

  if (!graded) {
    if (isMatrix || isMulti) {
      document.querySelectorAll('.option-btn').forEach(btn => {
        const cb = btn.querySelector('input');
        if (!cb) return;
        cb.onchange = () => {
          toggleSata(q.q_id, btn.dataset.opt, cb.checked, isMock);
          btn.classList.toggle('selected', cb.checked);
        };
      });
    } else {
      document.querySelectorAll('.option-btn').forEach(btn => {
        btn.onclick = () => {
          appState.examAnswers[q.q_id] = btn.dataset.opt;
          document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          const sb = document.getElementById('submitQBtn');
          if (sb) sb.disabled = false;
          const nb = document.getElementById('nextBtn');
          if (nb) nb.disabled = !isMock;
        };
      });
    }
  }

  document.getElementById('exitExamBtn').onclick = exitExam;

  const sq = document.getElementById('submitQBtn');
  if (sq) sq.onclick = () => submitSingleQuestion(q);

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
  else { const i = arr.indexOf(opt); if (i >= 0) arr.splice(i, 1); }
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
  let examSubmitted = false;
  try {
    const res = await Api.submitExam(appState.currentUser.user_id, 'mock', answers, appState.examConfig.examType);
    if (res.success) {
      examSubmitted = true;
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
  } finally {
    if (examSubmitted) {
      await showLogoPreloader('Exam complete!').finish();
    }
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
  await showLogoPreloader('Exam complete!').finish();
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
  window.addEventListener('scroll', updateBackToTopVisibility, { passive: true });
  const saved = localStorage.getItem('np_user');
  if (saved) {
    try { appState.currentUser = JSON.parse(saved); setView('dashboard'); return; } catch(e){}
  }
  setView('landing');
})();
