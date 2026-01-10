// Envisioner Discovery AI Sidebar Widget
// For discovery.envisioner.io
(function() {
  const API_BASE = 'https://discovery.envisioner.io';

  let dismissedActions = [];
  try {
    dismissedActions = JSON.parse(sessionStorage.getItem('env_discovery_dismissed') || '[]');
  } catch {}

  function saveDismissed() {
    sessionStorage.setItem('env_discovery_dismissed', JSON.stringify(dismissedActions));
  }

  function getUser() {
    if (window.logged_in_user?.email) return window.logged_in_user.email;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) { try { return atob(token); } catch {} }
    return params.get('user') || null;
  }

  function getContext() {
    if (window.getEnvisionerContext) return window.getEnvisionerContext();
    return null;
  }

  function buildApiContext(ctx) {
    if (!ctx) return {};
    return {
      currentPage: ctx.currentPage,
      viewing: ctx.viewing?.name || null,
      filters: ctx.filters || {},
      selectedCreator: ctx.selectedCreator || null,
    };
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatAnswer(text) {
    return escapeHtml(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#8B5CF6;text-decoration:none;font-weight:500;">$1</a>');
  }

  function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  function isOpenedAsPopup() {
    if (window.self !== window.top) return true;
    if (window.opener) return true;
    return false;
  }

  function createSidebar() {
    if (document.getElementById('env-discovery-sidebar')) return;
    if (isOpenedAsPopup()) return;
    const user = getUser();
    if (!user) return;

    if (!document.getElementById('env-inter-font')) {
      const link = document.createElement('link');
      link.id = 'env-inter-font';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
      document.head.appendChild(link);
    }

    const sidebar = document.createElement('div');
    sidebar.id = 'env-discovery-sidebar';
    sidebar.innerHTML = `
      <style>
        #env-discovery-sidebar {
          position: fixed;
          top: 0;
          right: 0;
          width: 380px;
          height: 100vh;
          background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
          border-left: 1px solid #2d2d44;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          display: flex;
          flex-direction: column;
          z-index: 100;
          overflow: hidden;
        }
        #env-discovery-sidebar * { box-sizing: border-box; }
        .env-discovery-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: #a0a0b0;
        }
        .env-discovery-spinner {
          width: 24px;
          height: 24px;
          border: 2px solid #2d2d44;
          border-top-color: #8B5CF6;
          border-radius: 50%;
          animation: envspin 0.8s linear infinite;
          margin-bottom: 12px;
        }
        @keyframes envspin { to { transform: rotate(360deg); } }
      </style>
      <div class="env-discovery-loading">
        <div class="env-discovery-spinner"></div>
        <span style="font-size:13px;">Loading Discovery AI...</span>
      </div>
    `;

    document.body.appendChild(sidebar);

    const toggle = document.createElement('button');
    toggle.id = 'env-discovery-toggle';
    toggle.style.cssText = 'display:none;position:fixed;bottom:20px;right:20px;width:48px;height:48px;background:linear-gradient(135deg,#8B5CF6 0%,#6366F1 100%);border:none;border-radius:12px;color:white;font-size:18px;cursor:pointer;z-index:101;box-shadow:0 4px 15px rgba(139,92,246,0.4);';
    toggle.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path></svg>`;
    toggle.onclick = () => sidebar.classList.toggle('open');
    document.body.appendChild(toggle);

    loadBriefing(sidebar, user);
  }

  async function loadBriefing(sidebar, user) {
    try {
      const res = await fetch(`${API_BASE}/api/discovery-briefing?user=${encodeURIComponent(user)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      renderSidebar(sidebar, user, data.briefing, data.data);
    } catch (err) {
      sidebar.innerHTML = `
        <div style="padding:24px;color:#EF4444;font-size:13px;text-align:center;">
          <p style="margin:0;">Could not load: ${err.message}</p>
        </div>
      `;
    }
  }

  function renderSidebar(sidebar, user, briefing, discoveryData) {
    const suggestedPrompts = briefing.suggestedPrompts || ['Find creators similar to my top performers', 'Who is live right now?', 'Best iGaming creators on TikTok'];

    const activeActions = (briefing.actions || [])
      .filter(a => a.options && Array.isArray(a.options) && !dismissedActions.includes(a.id))
      .map(action => ({
        ...action,
        options: action.options.filter(opt => opt.action !== 'dismiss' || true)
      }));

    sidebar.innerHTML = `
      <style>
        #env-discovery-sidebar {
          position: fixed;
          top: 0;
          right: 0;
          width: 380px;
          height: 100vh;
          background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
          border-left: 1px solid #2d2d44;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          display: flex;
          flex-direction: column;
          z-index: 9999;
          overflow: hidden;
        }
        #env-discovery-sidebar * { box-sizing: border-box; }

        .env-d-header {
          padding: 20px;
          background: rgba(139, 92, 246, 0.1);
          border-bottom: 1px solid #2d2d44;
        }
        .env-d-header-title {
          font-size: 16px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 4px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .env-d-header-title svg {
          color: #8B5CF6;
        }
        .env-d-header-sub {
          font-size: 12px;
          color: #a0a0b0;
        }
        .env-d-access-badge {
          display: inline-block;
          padding: 2px 8px;
          background: ${briefing.accessLevel === 'pro' || briefing.accessLevel === 'enterprise' ? 'linear-gradient(135deg,#8B5CF6,#6366F1)' : '#2d2d44'};
          border-radius: 4px;
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          color: #fff;
          margin-left: 8px;
        }

        .env-d-content {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .env-d-summary {
          background: rgba(139, 92, 246, 0.15);
          border: 1px solid rgba(139, 92, 246, 0.3);
          padding: 14px;
          border-radius: 10px;
        }
        .env-d-summary-label {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: #8B5CF6;
          margin-bottom: 8px;
        }
        .env-d-summary p {
          font-size: 13px;
          line-height: 1.6;
          margin: 0;
          color: rgba(255,255,255,0.9);
        }

        .env-d-metrics {
          display: flex;
          gap: 8px;
        }
        .env-d-metric {
          flex: 1;
          background: rgba(255,255,255,0.05);
          border: 1px solid #2d2d44;
          border-radius: 10px;
          padding: 12px;
          text-align: center;
        }
        .env-d-metric-value {
          font-size: 18px;
          font-weight: 700;
          color: #8B5CF6;
        }
        .env-d-metric-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #a0a0b0;
          margin-top: 2px;
        }

        .env-d-section-label {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: #a0a0b0;
          margin-bottom: 8px;
        }

        .env-d-action {
          background: rgba(255,255,255,0.05);
          border: 1px solid #2d2d44;
          border-radius: 10px;
          padding: 14px;
        }
        .env-d-action.high { border-left: 3px solid #8B5CF6; }
        .env-d-action.medium { border-left: 3px solid #6366F1; }
        .env-d-action.low { border-left: 3px solid #4B5563; }

        .env-d-action-top {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 12px;
        }
        .env-d-action-icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: rgba(139, 92, 246, 0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #8B5CF6;
          flex-shrink: 0;
        }
        .env-d-action-content { flex: 1; }
        .env-d-action-title {
          font-size: 13px;
          font-weight: 600;
          color: #fff;
          margin-bottom: 2px;
        }
        .env-d-action-desc {
          font-size: 12px;
          color: #a0a0b0;
          line-height: 1.4;
        }

        .env-d-action-btns {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .env-d-btn {
          padding: 7px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          border: none;
          transition: all 0.15s;
        }
        .env-d-btn.primary {
          background: linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%);
          color: #fff;
        }
        .env-d-btn.primary:hover { opacity: 0.9; }
        .env-d-btn.secondary {
          background: rgba(255,255,255,0.1);
          color: #fff;
        }
        .env-d-btn.secondary:hover { background: rgba(255,255,255,0.15); }
        .env-d-btn.ghost {
          background: transparent;
          color: #6B7280;
          padding: 7px 8px;
        }
        .env-d-btn.ghost:hover { color: #a0a0b0; }
        .env-d-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .env-d-chat-section {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .env-d-chat-box {
          background: rgba(0,0,0,0.2);
          border: 1px solid #2d2d44;
          border-radius: 10px;
          flex: 1;
          overflow-y: auto;
          min-height: 120px;
        }
        .env-d-chat-msg {
          padding: 10px 12px;
          font-size: 13px;
          line-height: 1.5;
          border-bottom: 1px solid #2d2d44;
        }
        .env-d-chat-msg:last-child { border-bottom: none; }
        .env-d-chat-msg.user { background: rgba(139, 92, 246, 0.1); color: #e0e0e0; }
        .env-d-chat-msg.assistant { background: transparent; color: #fff; }

        .env-d-input-area {
          padding: 12px 16px;
          background: rgba(0,0,0,0.3);
          border-top: 1px solid #2d2d44;
        }
        .env-d-prompts {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 10px;
        }
        .env-d-prompt {
          background: rgba(255,255,255,0.05);
          border: 1px solid #2d2d44;
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 12px;
          color: #e0e0e0;
          cursor: pointer;
          text-align: left;
          transition: all 0.15s;
        }
        .env-d-prompt:hover {
          background: rgba(139, 92, 246, 0.15);
          border-color: #8B5CF6;
        }

        .env-d-input-wrap {
          display: flex;
          gap: 8px;
          background: rgba(0,0,0,0.3);
          border: 1px solid #2d2d44;
          border-radius: 8px;
          padding: 6px;
        }
        .env-d-input-wrap input {
          flex: 1;
          border: none;
          outline: none;
          font-size: 13px;
          padding: 8px;
          background: transparent;
          font-family: inherit;
          color: #fff;
        }
        .env-d-input-wrap input::placeholder { color: #6B7280; }
        .env-d-input-wrap button {
          background: linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%);
          border: none;
          border-radius: 6px;
          padding: 8px 14px;
          color: #fff;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        .env-d-input-wrap button:hover { opacity: 0.9; }
        .env-d-input-wrap button:disabled { opacity: 0.5; cursor: not-allowed; }

        .env-d-typing {
          display: flex;
          gap: 4px;
          padding: 12px;
        }
        .env-d-typing span {
          width: 6px;
          height: 6px;
          background: #8B5CF6;
          border-radius: 50%;
          animation: envbounce 1.4s ease-in-out infinite;
        }
        .env-d-typing span:nth-child(1) { animation-delay: -0.32s; }
        .env-d-typing span:nth-child(2) { animation-delay: -0.16s; }
        @keyframes envbounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }

        .env-d-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid #2d2d44;
          border-top-color: #8B5CF6;
          border-radius: 50%;
          animation: envspin 0.8s linear infinite;
        }

        @media (max-width: 900px) {
          #env-discovery-sidebar {
            display: none;
            width: 100% !important;
            max-width: 380px;
            box-shadow: -4px 0 20px rgba(0,0,0,0.3);
          }
          #env-discovery-sidebar.open { display: flex; }
          #env-discovery-toggle { display: flex !important; align-items: center; justify-content: center; }
        }
      </style>

      <div class="env-d-header">
        <div class="env-d-header-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="M21 21l-4.35-4.35"></path>
          </svg>
          Discovery AI
          <span class="env-d-access-badge">${briefing.accessLevel || 'basic'}</span>
        </div>
        <div class="env-d-header-sub">Find your next top performer</div>
      </div>

      <div class="env-d-content">
        <div class="env-d-summary">
          <div class="env-d-summary-label">AI Insights</div>
          <p>${briefing.summary || 'Start exploring creators in our database.'}</p>
        </div>

        <div class="env-d-metrics">
          ${briefing.metrics.map(m => `
            <div class="env-d-metric">
              <div class="env-d-metric-value">${m.value}</div>
              <div class="env-d-metric-label">${m.label}</div>
            </div>
          `).join('')}
        </div>

        ${activeActions.length > 0 ? `
          <div>
            <div class="env-d-section-label">Opportunities</div>
            ${activeActions.map(action => `
              <div class="env-d-action ${action.priority}" data-action-id="${action.id}" style="margin-bottom: 10px;">
                <div class="env-d-action-top">
                  <div class="env-d-action-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      ${action.type === 'discovery' ? '<circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path>' : '<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path>'}
                    </svg>
                  </div>
                  <div class="env-d-action-content">
                    <div class="env-d-action-title">${escapeHtml(action.title)}</div>
                    <div class="env-d-action-desc">${escapeHtml(action.description)}</div>
                  </div>
                </div>
                <div class="env-d-action-btns">
                  ${action.options.map(opt => `
                    <button class="env-d-btn ${opt.variant}"
                            data-action="${opt.action}"
                            data-params='${JSON.stringify(opt.params)}'
                            data-card-id="${action.id}">
                      ${escapeHtml(opt.label)}
                    </button>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <div class="env-d-chat-section">
          <div class="env-d-section-label">Ask Discovery AI</div>
          <div class="env-d-chat-box" id="env-d-conversation"></div>
        </div>
      </div>

      <div class="env-d-input-area">
        <div class="env-d-prompts">
          ${suggestedPrompts.map(p => `<button class="env-d-prompt">${escapeHtml(p)}</button>`).join('')}
        </div>
        <div class="env-d-input-wrap">
          <input type="text" id="env-d-question" placeholder="Ask about creators, performance, recommendations..." autocomplete="off">
          <button id="env-d-send">Ask</button>
        </div>
      </div>
    `;

    // Handle action buttons
    sidebar.querySelectorAll('.env-d-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const action = btn.dataset.action;
        const params = JSON.parse(btn.dataset.params || '{}');
        const cardId = btn.dataset.cardId;
        const card = btn.closest('.env-d-action');

        if (action === 'dismiss') {
          dismissedActions.push(params.action_id);
          saveDismissed();
          if (card) {
            card.style.transition = 'opacity 0.2s, transform 0.2s';
            card.style.opacity = '0';
            card.style.transform = 'translateX(20px)';
            setTimeout(() => card.remove(), 200);
          }
          return;
        }

        if (action === 'navigate') {
          const url = params.url;
          if (url) {
            if (url.startsWith('/')) {
              window.location.href = url;
            } else {
              window.open(url, '_blank');
            }
          }
          return;
        }
      });
    });

    // Handle chat
    const input = sidebar.querySelector('#env-d-question');
    const sendBtn = sidebar.querySelector('#env-d-send');
    const conversation = sidebar.querySelector('#env-d-conversation');

    async function handleSubmit() {
      const question = input.value.trim();
      if (!question) return;
      input.value = '';
      sendBtn.disabled = true;

      conversation.innerHTML += `<div class="env-d-chat-msg user">${escapeHtml(question)}</div>`;
      conversation.innerHTML += `<div class="env-d-typing" id="env-d-typing"><span></span><span></span><span></span></div>`;
      conversation.scrollTop = conversation.scrollHeight;

      try {
        const ctx = getContext();
        const res = await fetch(`${API_BASE}/api/discovery-ask`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user, question, context: buildApiContext(ctx) })
        });
        const data = await res.json();
        const typing = sidebar.querySelector('#env-d-typing');
        if (typing) typing.remove();

        const answer = data.success ? data.answer : 'Sorry, something went wrong.';
        conversation.innerHTML += `<div class="env-d-chat-msg assistant">${formatAnswer(answer)}</div>`;

        // If creators were returned, show them
        if (data.creators && data.creators.length > 0) {
          const creatorsHtml = data.creators.slice(0, 5).map(c => {
            const perf = c.performanceData ? `$${c.performanceData.avgCpa?.toFixed(0) || '?'} CPA` : '';
            return `<div style="padding:8px;background:rgba(139,92,246,0.1);border-radius:6px;margin-top:6px;font-size:12px;">
              <strong style="color:#8B5CF6;">${escapeHtml(c.displayName || c.name)}</strong>
              <span style="color:#a0a0b0;margin-left:8px;">${c.platform} · ${formatNumber(c.followers || 0)} followers ${perf ? '· ' + perf : ''}</span>
            </div>`;
          }).join('');
          conversation.innerHTML += `<div class="env-d-chat-msg assistant" style="padding-top:0;">${creatorsHtml}</div>`;
        }

        // If live creators were returned, show them
        if (data.liveCreators && data.liveCreators.length > 0) {
          const liveHtml = data.liveCreators.slice(0, 5).map(c => {
            return `<div style="padding:8px;background:rgba(239,68,68,0.15);border-radius:6px;margin-top:6px;font-size:12px;border-left:3px solid #EF4444;">
              <strong style="color:#EF4444;">LIVE</strong>
              <strong style="color:#fff;margin-left:8px;">${escapeHtml(c.displayName || c.name)}</strong>
              <span style="color:#a0a0b0;margin-left:8px;">${formatNumber(c.currentViewers || 0)} viewers</span>
            </div>`;
          }).join('');
          conversation.innerHTML += `<div class="env-d-chat-msg assistant" style="padding-top:0;">${liveHtml}</div>`;
        }

        conversation.scrollTop = conversation.scrollHeight;
      } catch (err) {
        const typing = sidebar.querySelector('#env-d-typing');
        if (typing) typing.remove();
        conversation.innerHTML += `<div class="env-d-chat-msg assistant">Could not connect.</div>`;
      }
      sendBtn.disabled = false;
      input.focus();
    }

    sendBtn.addEventListener('click', handleSubmit);
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSubmit(); });

    sidebar.querySelectorAll('.env-d-prompt').forEach(btn => {
      btn.addEventListener('click', () => {
        input.value = btn.textContent;
        handleSubmit();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createSidebar);
  } else {
    createSidebar();
  }
})();
