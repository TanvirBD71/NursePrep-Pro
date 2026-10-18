// ===== API Client =====
// Configure your deployed Google Apps Script Web App URL here.
const API_BASE = (localStorage.getItem('api_base') || '').trim() || 'https://script.google.com/macros/s/AKfycby3W9_z-EsC9resFNC08zp48qA_6Z7H1LEGhaRvHGkz-48z3tyzh45V-OgUNuyyd0Er/exec';

const Api = {
  async request(action, method, payload) {
    const url = API_BASE + '?action=' + encodeURIComponent(action);
    const opts = { method: method || 'GET', headers: { 'Content-Type': 'text/plain;charset=UTF-8' } };
    if (method === 'POST' && payload) {
      opts.body = JSON.stringify(Object.assign({ action: action }, payload));
    }
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  },
  login(email, password) {
    return this.request('login', 'POST', { email: email, password: password });
  },
  register(email, password, targetExam) {
    return this.request('register', 'POST', { email: email, password: password, target_exam: targetExam });
  },
  getExam(examType, count, category) {
    let url = API_BASE + '?action=get_exam&exam_type=' + encodeURIComponent(examType) + '&count=' + encodeURIComponent(count);
    if (category) url += '&category=' + encodeURIComponent(category);
    return fetch(url).then(r => r.json());
  },
  gradeQuestion(qId, userAnswer) {
    return this.request('grade_question', 'POST', { q_id: qId, user_answer: userAnswer });
  },
  submitExam(userId, mode, answers) {
    return this.request('submit_exam', 'POST', { user_id: userId, mode: mode, answers: answers });
  }
};

// Allow overriding API base via console for testing
window.setApiBase = function(url) {
  localStorage.setItem('api_base', url);
  location.reload();
};
