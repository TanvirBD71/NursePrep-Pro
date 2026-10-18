// ===== API Client =====
// Configure your deployed Google Apps Script Web App URL here.
const API_BASE = (localStorage.getItem('api_base') || '').trim() || 'https://script.google.com/macros/s/AKfycbyvRKw5u89pGm_2V32FMyDIEQ1p4cF808tvUwLhD1r7Gq_rwnz8-q_AzKDHN-zumAgi/exec';

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
  submitExam(userId, mode, answers, examType) {
    return this.request('submit_exam', 'POST', { user_id: userId, mode: mode, exam_type: examType || '', answers: answers });
  },
  async getDashboard(userId) {
    const url = API_BASE + '?action=get_dashboard&user_id=' + encodeURIComponent(userId);
    const readResponse = async (response) => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    };
    const response = await fetch(url);
    const result = await readResponse(response);
    if (!result || result.error !== 'Unknown GET action: get_dashboard') return result;

    const fallback = await this.request('get_dashboard', 'POST', { user_id: userId });
    if (fallback && fallback.error === 'Unknown POST action: get_dashboard') {
      return {
        success: false,
        error: 'Dashboard sessions are not supported by the deployed Apps Script. Update the Apps Script from backend/Code.gs and deploy a new web app version.'
      };
    }
    return fallback;
  },
  getCategories(examType) {
    let url = API_BASE + '?action=get_categories';
    if (examType) url += '&exam_type=' + encodeURIComponent(examType);
    return fetch(url).then(r => r.json());
  }
};

// Allow overriding API base via console for testing
window.setApiBase = function(url) {
  localStorage.setItem('api_base', url);
  location.reload();
};
