// Envisioner AI Sidebar Widget
(function() {
  const API_BASE = 'https://ai.envisioner.io';

  // Check for embed mode from script tag or window config
  const scriptTag = document.currentScript;
  const embedMode = scriptTag?.getAttribute('data-embed') || window.ENVISIONER_EMBED_MODE || 'fixed';
  // 'fixed' = locked to viewport (default)
  // 'inline' = flows with page content, no fixed positioning

  let dismissedActions = [];
  try {
    dismissedActions = JSON.parse(sessionStorage.getItem('env_dismissed') || '[]');
  } catch {}

  // Resize state - global within IIFE
  let isResizing = false;
  let isMinimized = false;
  let currentWidth = null;
  let sidebarElement = null;
  const MIN_WIDTH = 280;
  const MINIMIZED_WIDTH = 52;
  const MAX_WIDTH_PERCENT = 0.85;

  // Global mouse handlers for drag resize
  document.addEventListener('mousemove', function(e) {
    if (!isResizing || !sidebarElement) return;
    e.preventDefault();

    const viewportWidth = window.innerWidth;
    const maxWidth = viewportWidth * MAX_WIDTH_PERCENT;
    const newWidth = viewportWidth - e.clientX;

    if (newWidth < MIN_WIDTH / 2) {
      // Minimize when dragged past threshold
      if (!isMinimized) {
        isMinimized = true;
        sidebarElement.classList.add('minimized');
        sidebarElement.style.width = MINIMIZED_WIDTH + 'px';
      }
    } else {
      // Normal resize
      if (isMinimized) {
        isMinimized = false;
        sidebarElement.classList.remove('minimized');
      }
      currentWidth = Math.max(MIN_WIDTH, Math.min(newWidth, maxWidth));
      sidebarElement.style.width = currentWidth + 'px';
    }
  });

  document.addEventListener('mouseup', function() {
    if (isResizing && sidebarElement) {
      isResizing = false;
      sidebarElement.classList.remove('resizing');
      const handle = sidebarElement.querySelector('.env-resize-handle');
      if (handle) handle.classList.remove('active');
    }
  });

  function saveDismissed() {
    sessionStorage.setItem('env_dismissed', JSON.stringify(dismissedActions));
  }

  function getUser() {
    // Softr logged-in user
    if (window.logged_in_user?.email) return window.logged_in_user.email;
    if (window.logged_in_user?.Email) return window.logged_in_user.Email;
    // Softr alternative
    if (window.softr?.user?.email) return window.softr.user.email;
    // Window config
    if (window.ENVISIONER_USER) return window.ENVISIONER_USER;
    // Script tag attribute
    if (scriptTag?.getAttribute('data-user')) return scriptTag.getAttribute('data-user');
    // URL params
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
      recentPages: ctx.pageViews?.slice(-5).map(p => p.page) || [],
      recentActions: ctx.actions?.slice(-5).map(a => a.text) || []
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
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#FF6B35;text-decoration:none;font-weight:500;">$1</a>');
  }

  function getMenuRightEdge() {
    const selectors = ['nav', '[class*="navbar"]', '[class*="navigation"]', '[class*="header"]', '[class*="menu"]', 'header'];
    let rightEdge = 0;
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        const buttons = el.querySelectorAll('a, button');
        buttons.forEach(btn => {
          const rect = btn.getBoundingClientRect();
          if (rect.right > rightEdge && rect.top < 100) {
            rightEdge = rect.right;
          }
        });
      });
    }
    return rightEdge;
  }

  function isOpenedAsPopup() {
    // Check if running inside an iframe
    if (window.self !== window.top) return true;
    // Check if opened as a popup window
    if (window.opener) return true;
    return false;
  }

  function createSidebar() {
    if (document.getElementById('env-sidebar')) return true; // Already created
    // Don't show widget if site is opened in a popup or iframe (unless inline mode)
    if (embedMode !== 'inline' && isOpenedAsPopup()) return true; // Skip but don't retry
    const user = getUser();
    if (!user) {
      return false; // Retry later
    }

    if (!document.getElementById('env-inter-font')) {
      const link = document.createElement('link');
      link.id = 'env-inter-font';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
      document.head.appendChild(link);
    }

    const sidebar = document.createElement('div');
    sidebar.id = 'env-sidebar';
    sidebarElement = sidebar; // Store globally for resize handlers

    const isInline = embedMode === 'inline';
    sidebar.innerHTML = `
      <style>
        #env-sidebar {
          position: ${isInline ? 'relative' : 'fixed'};
          ${isInline ? '' : 'top: 0; right: 0;'}
          width: ${isInline ? '100%' : '420px'};
          ${isInline ? 'max-width: 100%;' : ''}
          height: ${isInline ? 'auto' : '100vh'};
          ${isInline ? 'min-height: 500px;' : ''}
          background: #FAFAFA;
          ${isInline ? '' : 'border-left: 1px solid #E8E8E8;'}
          ${isInline ? 'border: 1px solid #E8E8E8; border-radius: 12px;' : ''}
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          display: flex;
          flex-direction: column;
          z-index: ${isInline ? '1' : '100'};
          overflow: hidden;
        }
        #env-sidebar.resizing { user-select: none; }
        #env-sidebar.minimized .env-sidebar-content { opacity: 0; pointer-events: none; }
        #env-sidebar.minimized .env-minimized-indicator { display: flex; }
        #env-sidebar * { box-sizing: border-box; }
        ${isInline ? '.env-resize-handle { display: none !important; }' : ''}
        .env-resize-handle {
          position: absolute;
          left: -4px;
          top: 0;
          bottom: 0;
          width: 12px;
          cursor: ew-resize;
          background: transparent;
          z-index: 200;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .env-resize-handle:hover, .env-resize-handle.active {
          background: linear-gradient(90deg, rgba(255, 107, 53, 0.3) 0%, transparent 100%);
        }
        .env-resize-grip {
          width: 4px;
          height: 60px;
          background: #bbb;
          border-radius: 2px;
          transition: background 0.15s, transform 0.15s;
          margin-left: 2px;
        }
        .env-resize-handle:hover .env-resize-grip,
        .env-resize-handle.active .env-resize-grip {
          background: #FF6B35;
          transform: scaleY(1.2);
        }
        .env-sidebar-content { display: flex; flex-direction: column; height: 100%; }
        .env-minimized-indicator {
          display: none;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          cursor: ew-resize;
          padding: 16px 8px;
        }
        .env-minimized-icon {
          width: 32px;
          height: 32px;
          background: linear-gradient(135deg, #FF6B35, #e55a2b);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 12px;
        }
        .env-minimized-icon svg { width: 18px; height: 18px; color: #fff; }
        .env-minimized-text {
          writing-mode: vertical-rl;
          text-orientation: mixed;
          font-size: 12px;
          font-weight: 600;
          color: #888;
          letter-spacing: 1px;
        }
        .env-sidebar-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: #888;
        }
        .env-sidebar-spinner {
          width: 24px;
          height: 24px;
          border: 2px solid #E8E8E8;
          border-top-color: #141C2E;
          border-radius: 50%;
          animation: envspin 0.8s linear infinite;
          margin-bottom: 12px;
        }
        @keyframes envspin { to { transform: rotate(360deg); } }
        @media (max-width: 900px) {
          .env-resize-handle { display: none !important; }
        }
      </style>
      <div class="env-resize-handle" id="env-resize-handle">
        <div class="env-resize-grip"></div>
      </div>
      <div class="env-minimized-indicator" id="env-minimized-indicator">
        <div class="env-minimized-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <span class="env-minimized-text">AI</span>
      </div>
      <div class="env-sidebar-content">
        <div class="env-sidebar-loading">
          <div class="env-sidebar-spinner"></div>
          <span style="font-size:13px;">Loading...</span>
        </div>
      </div>
    `;

    // Setup resize drag functionality
    const resizeHandle = sidebar.querySelector('#env-resize-handle');
    const minimizedIndicator = sidebar.querySelector('#env-minimized-indicator');

    function startResize(e) {
      e.preventDefault();
      isResizing = true;
      sidebar.classList.add('resizing');
      if (resizeHandle) resizeHandle.classList.add('active');
    }

    resizeHandle.addEventListener('mousedown', startResize);
    minimizedIndicator.addEventListener('mousedown', startResize);

    document.body.appendChild(sidebar);

    const toggle = document.createElement('button');
    toggle.id = 'env-toggle';
    toggle.style.cssText = 'display:none;position:fixed;bottom:20px;right:20px;width:48px;height:48px;background:#141C2E;border:none;border-radius:12px;color:white;font-size:18px;cursor:pointer;z-index:101;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
    toggle.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
    toggle.onclick = () => sidebar.classList.toggle('open');
    document.body.appendChild(toggle);

    function positionSidebar() {
      const viewportWidth = window.innerWidth;
      if (viewportWidth <= 900) return;
      const menuRight = getMenuRightEdge();
      const padding = 40;
      if (menuRight > 0) {
        const availableWidth = viewportWidth - menuRight - padding;
        if (availableWidth < 300) {
          let sidebarWidth = Math.round(viewportWidth * 0.35);
          sidebarWidth = Math.max(350, Math.min(500, sidebarWidth));
          sidebar.style.display = 'flex';
          sidebar.style.left = 'auto';
          sidebar.style.right = '0';
          sidebar.style.width = sidebarWidth + 'px';
        } else {
          sidebar.style.display = 'flex';
          sidebar.style.left = (menuRight + padding) + 'px';
          sidebar.style.right = '0';
          sidebar.style.width = 'auto';
        }
      } else {
        let sidebarWidth = Math.round(viewportWidth * 0.35);
        sidebarWidth = Math.max(350, Math.min(500, sidebarWidth));
        sidebar.style.display = 'flex';
        sidebar.style.left = 'auto';
        sidebar.style.right = '0';
        sidebar.style.width = sidebarWidth + 'px';
      }
    }

    setTimeout(positionSidebar, 500);
    window.addEventListener('resize', positionSidebar);
    loadBriefing(sidebar, user);
    return true; // Success
  }

  async function loadBriefing(sidebar, user) {
    try {
      const currentPage = encodeURIComponent(window.location.pathname);
      const res = await fetch(`${API_BASE}/api/briefing?user=${encodeURIComponent(user)}&page=${currentPage}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      renderSidebar(sidebar, user, data.briefing);
    } catch (err) {
      sidebar.innerHTML = `
        <div style="padding:24px;color:#DC2626;font-size:13px;text-align:center;">
          <p style="margin:0;">Could not load: ${err.message}</p>
        </div>
      `;
    }
  }

  function getScoreGrade(score) {
    if (score >= 80) return { label: 'Excellent', color: '#22c55e' };
    if (score >= 60) return { label: 'Good', color: '#FF6B35' };
    if (score >= 40) return { label: 'Fair', color: '#f59e0b' };
    return { label: 'Needs Work', color: '#ef4444' };
  }

  function renderSidebar(sidebar, user, briefing) {
    const grade = getScoreGrade(briefing.score);
    const currentUrl = window.location.href.toLowerCase();
    const suggestedPrompts = briefing.suggestedPrompts || ['What should I focus on today?', 'Which platform is performing best?', 'Who are my top creators?'];

    const activeActions = (briefing.actions || [])
      .filter(a => a.options && Array.isArray(a.options) && !dismissedActions.includes(a.id))
      .map(action => ({
        ...action,
        options: action.options.filter(opt => {
          if (opt.action !== 'navigate') return true;
          const targetUrl = (opt.params?.url || '').toLowerCase();
          return !currentUrl.includes(targetUrl.replace('https://app.envisioner.io', ''));
        })
      }))
      .filter(action => action.options.some(opt => opt.action !== 'dismiss'));

    const circumference = 2 * Math.PI * 36;
    const offset = circumference - (briefing.score / 100) * circumference;

    const isInline = embedMode === 'inline';
    sidebar.innerHTML = `
      <style>
        #env-sidebar {
          position: ${isInline ? 'relative' : 'fixed'};
          ${isInline ? '' : 'top: 0; right: 0;'}
          ${isInline ? 'width: 100%; max-width: 100%;' : ''}
          height: ${isInline ? 'auto' : '100vh'};
          ${isInline ? 'min-height: 600px;' : ''}
          background: #FAFAFA;
          ${isInline ? '' : 'border-left: 1px solid #E8E8E8;'}
          ${isInline ? 'border: 1px solid #E8E8E8; border-radius: 12px;' : ''}
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          display: flex;
          flex-direction: column;
          z-index: ${isInline ? '1' : '9999'};
          overflow: hidden;
        }
        #env-sidebar.resizing { user-select: none; }
        #env-sidebar.minimized .env-sidebar-content { opacity: 0; pointer-events: none; }
        #env-sidebar.minimized .env-minimized-indicator { display: flex; }
        #env-sidebar * { box-sizing: border-box; }
        ${isInline ? '.env-resize-handle { display: none !important; }' : ''}
        .env-resize-handle {
          position: absolute;
          left: -4px;
          top: 0;
          bottom: 0;
          width: 12px;
          cursor: ew-resize;
          background: transparent;
          z-index: 200;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .env-resize-handle:hover, .env-resize-handle.active {
          background: linear-gradient(90deg, rgba(255, 107, 53, 0.3) 0%, transparent 100%);
        }
        .env-resize-grip {
          width: 4px;
          height: 60px;
          background: #bbb;
          border-radius: 2px;
          transition: background 0.15s, transform 0.15s;
          margin-left: 2px;
        }
        .env-resize-handle:hover .env-resize-grip,
        .env-resize-handle.active .env-resize-grip {
          background: #FF6B35;
          transform: scaleY(1.2);
        }
        .env-sidebar-content { display: flex; flex-direction: column; height: 100%; }
        .env-minimized-indicator {
          display: none;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          cursor: ew-resize;
          padding: 16px 8px;
        }
        .env-minimized-icon {
          width: 32px;
          height: 32px;
          background: linear-gradient(135deg, #FF6B35, #e55a2b);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 12px;
        }
        .env-minimized-icon svg { width: 18px; height: 18px; color: #fff; }
        .env-minimized-text {
          writing-mode: vertical-rl;
          text-orientation: mixed;
          font-size: 12px;
          font-weight: 600;
          color: #888;
          letter-spacing: 1px;
        }

        .env-header {
          padding: 20px;
          background: #fff;
          border-bottom: 1px solid #E8E8E8;
        }

        .env-score-section {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 16px;
        }

        .env-score-ring {
          position: relative;
          width: 80px;
          height: 80px;
        }
        .env-score-ring svg {
          transform: rotate(-90deg);
        }
        .env-score-ring-bg {
          fill: none;
          stroke: #E8E8E8;
          stroke-width: 6;
        }
        .env-score-ring-progress {
          fill: none;
          stroke: ${grade.color};
          stroke-width: 6;
          stroke-linecap: round;
          stroke-dasharray: ${circumference};
          stroke-dashoffset: ${offset};
          transition: stroke-dashoffset 0.6s ease;
        }
        .env-score-value {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 22px;
          font-weight: 700;
          color: #141C2E;
        }

        .env-score-info {
          text-align: right;
        }
        .env-score-grade {
          font-size: 14px;
          font-weight: 600;
          color: ${grade.color};
          margin-bottom: 4px;
        }
        .env-score-label {
          font-size: 12px;
          color: #666;
        }

        .env-content {
          flex: 1;
          overflow: hidden;
          padding: 16px;
          display: flex;
          flex-direction: column;
        }

        .env-metrics {
          display: flex;
          gap: 8px;
          margin-bottom: 16px;
        }
        .env-metric {
          flex: 1;
          background: #fff;
          border: 1px solid #E8E8E8;
          border-radius: 10px;
          padding: 12px;
          text-align: center;
        }
        .env-metric-value {
          font-size: 16px;
          font-weight: 700;
          color: #FF6B35;
        }
        .env-metric-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #888;
          margin-top: 2px;
        }

        .env-section-label {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: #888;
          margin-bottom: 10px;
        }

        .env-action {
          background: #fff;
          border: 1px solid #E8E8E8;
          border-radius: 10px;
          padding: 14px;
          margin-bottom: 10px;
        }
        .env-action.high { border-left: 3px solid #DC2626; }
        .env-action.medium { border-left: 3px solid #F59E0B; }
        .env-action.low { border-left: 3px solid #10B981; }

        .env-action-top {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 12px;
        }
        .env-action-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-top: 5px;
          flex-shrink: 0;
        }
        .env-action.high .env-action-indicator { background: #DC2626; }
        .env-action.medium .env-action-indicator { background: #F59E0B; }
        .env-action.low .env-action-indicator { background: #10B981; }

        .env-action-content { flex: 1; }
        .env-action-title {
          font-size: 13px;
          font-weight: 600;
          color: #141C2E;
          margin-bottom: 2px;
        }
        .env-action-desc {
          font-size: 12px;
          color: #666;
          line-height: 1.4;
        }

        .env-action-btns {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .env-btn {
          padding: 7px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          border: none;
          transition: all 0.15s;
        }
        .env-btn.primary {
          background: #FF6B35;
          color: #fff;
        }
        .env-btn.primary:hover { background: #e55a2b; }
        .env-btn.secondary {
          background: #F3F4F6;
          color: #374151;
        }
        .env-btn.secondary:hover { background: #E5E7EB; }
        .env-btn.ghost {
          background: transparent;
          color: #9CA3AF;
          padding: 7px 8px;
        }
        .env-btn.ghost:hover { color: #666; }
        .env-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .env-chat-section {
          margin-top: 12px;
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 200px;
        }
        .env-chat-box {
          background: #fff;
          border: 1px solid #E8E8E8;
          border-radius: 10px;
          flex: 1;
          overflow-y: auto;
          min-height: 180px;
        }
        .env-chat-msg {
          padding: 12px 14px;
          font-size: 13px;
          line-height: 1.5;
        }
        .env-chat-msg.user {
          background: #F9FAFB;
          color: #374151;
          border-bottom: 1px solid #E8E8E8;
        }
        .env-chat-msg.assistant {
          background: #fff;
          color: #141C2E;
        }

        .env-input-area {
          padding: 12px 16px;
          background: #fff;
          border-top: 1px solid #E8E8E8;
        }
        .env-input-wrap {
          display: flex;
          gap: 8px;
          background: #F9FAFB;
          border: 1px solid #E8E8E8;
          border-radius: 8px;
          padding: 6px;
        }
        .env-input-wrap input {
          flex: 1;
          border: none;
          outline: none;
          font-size: 13px;
          padding: 8px;
          background: transparent;
          font-family: inherit;
        }
        .env-input-wrap input::placeholder { color: #9CA3AF; }
        .env-input-wrap button {
          background: #FF6B35;
          border: none;
          border-radius: 6px;
          padding: 8px 14px;
          color: #fff;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        .env-input-wrap button:hover { background: #e55a2b; }
        .env-input-wrap button:disabled { background: #9CA3AF; cursor: not-allowed; }

        .env-prompts {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 10px;
        }
        .env-prompt {
          background: #F9FAFB;
          border: 1px solid #E8E8E8;
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 12px;
          color: #374151;
          cursor: pointer;
          text-align: left;
          transition: background 0.15s, border-color 0.15s;
        }
        .env-prompt:hover {
          background: #F3F4F6;
          border-color: #FF6B35;
        }

        .env-typing {
          display: flex;
          gap: 4px;
          padding: 12px;
        }
        .env-typing span {
          width: 6px;
          height: 6px;
          background: #FF6B35;
          border-radius: 50%;
          animation: envbounce 1.4s ease-in-out infinite;
        }
        .env-typing span:nth-child(1) { animation-delay: -0.32s; }
        .env-typing span:nth-child(2) { animation-delay: -0.16s; }
        @keyframes envbounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }

        .env-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid #E8E8E8;
          border-top-color: #FF6B35;
          border-radius: 50%;
          animation: envspin 0.8s linear infinite;
        }
        @keyframes envspin { to { transform: rotate(360deg); } }

        /* Modal */
        .env-modal {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.4);
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          animation: envfade 0.2s ease;
        }
        @keyframes envfade { from { opacity: 0; } to { opacity: 1; } }
        .env-modal-box {
          background: #fff;
          border-radius: 12px;
          width: 100%;
          max-width: 420px;
          max-height: 80vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          animation: envslide 0.25s ease;
        }
        @keyframes envslide {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .env-modal-header {
          padding: 16px 20px;
          border-bottom: 1px solid #E8E8E8;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .env-modal-header h3 {
          font-size: 15px;
          font-weight: 600;
          color: #141C2E;
          margin: 0;
        }
        .env-modal-close {
          background: none;
          border: none;
          color: #9CA3AF;
          cursor: pointer;
          font-size: 20px;
          padding: 0;
          line-height: 1;
        }
        .env-modal-close:hover { color: #141C2E; }
        .env-modal-body {
          padding: 20px;
          overflow-y: auto;
          font-size: 14px;
          line-height: 1.6;
          color: #141C2E;
        }
        .env-modal-template {
          background: #F9FAFB;
          border: 1px solid #E8E8E8;
          border-radius: 8px;
          padding: 14px;
          margin-top: 12px;
          font-size: 13px;
          white-space: pre-wrap;
        }
        .env-modal-footer {
          padding: 16px 20px;
          border-top: 1px solid #E8E8E8;
          display: flex;
          gap: 10px;
          justify-content: flex-end;
        }
        .env-modal-btn {
          padding: 10px 18px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          border: none;
        }
        .env-modal-btn.primary { background: #FF6B35; color: #fff; }
        .env-modal-btn.primary:hover { background: #e55a2b; }
        .env-modal-btn.secondary { background: #F3F4F6; color: #374151; }

        @media (max-width: 900px) {
          #env-sidebar {
            display: none;
            left: auto !important;
            right: 0 !important;
            width: 100% !important;
            max-width: 400px;
            box-shadow: -4px 0 20px rgba(0,0,0,0.1);
          }
          #env-sidebar.open { display: flex; }
          #env-toggle { display: flex !important; align-items: center; justify-content: center; }
          .env-resize-handle { display: none !important; }
        }
      </style>

      <div class="env-resize-handle" id="env-resize-handle">
        <div class="env-resize-grip"></div>
      </div>
      <div class="env-minimized-indicator" id="env-minimized-indicator">
        <div class="env-minimized-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <span class="env-minimized-text">AI</span>
      </div>

      <div class="env-sidebar-content">
      <div class="env-header">
        <div class="env-score-section">
          <div class="env-score-info">
            <div class="env-score-grade">${grade.label}</div>
            <div class="env-score-label">Campaign Health Score</div>
          </div>
          <div class="env-score-ring">
            <svg width="80" height="80" viewBox="0 0 80 80">
              <circle class="env-score-ring-bg" cx="40" cy="40" r="36"/>
              <circle class="env-score-ring-progress" cx="40" cy="40" r="36"/>
            </svg>
            <div class="env-score-value">${briefing.score}</div>
          </div>
        </div>
      </div>

      <div class="env-content">
        <div class="env-metrics">
          ${briefing.metrics.map(m => `
            <div class="env-metric">
              <div class="env-metric-value">${m.value}</div>
              <div class="env-metric-label">${m.label}</div>
            </div>
          `).join('')}
        </div>

        ${activeActions.length > 0 ? `
          <div class="env-section-label">Actions</div>
          ${activeActions.map(action => `
            <div class="env-action ${action.priority}" data-action-id="${action.id}">
              <div class="env-action-top">
                <div class="env-action-indicator"></div>
                <div class="env-action-content">
                  <div class="env-action-title">${escapeHtml(action.title)}</div>
                  <div class="env-action-desc">${escapeHtml(action.description)}</div>
                </div>
              </div>
              <div class="env-action-btns">
                ${action.options.map(opt => `
                  <button class="env-btn ${opt.variant}"
                          data-action="${opt.action}"
                          data-params='${JSON.stringify(opt.params)}'
                          data-card-id="${action.id}">
                    ${escapeHtml(opt.label)}
                  </button>
                `).join('')}
              </div>
            </div>
          `).join('')}
        ` : ''}

        <div class="env-chat-section">
          <div class="env-section-label">Ask Envisioner AI</div>
          <div class="env-chat-box" id="env-conversation">
            <div class="env-chat-msg assistant">${briefing.summary}</div>
          </div>
        </div>
      </div>

      <div class="env-input-area">
        <div class="env-prompts">
          ${suggestedPrompts.map(p => `<button class="env-prompt">${escapeHtml(p)}</button>`).join('')}
        </div>
        <div class="env-input-wrap">
          <input type="text" id="env-question" placeholder="Ask about campaigns, creators, performance..." autocomplete="off">
          <button id="env-send">Send</button>
        </div>
      </div>
      </div>
    `;

    // Re-attach resize event listeners after render
    const resizeHandle = sidebar.querySelector('#env-resize-handle');
    const minimizedIndicator = sidebar.querySelector('#env-minimized-indicator');

    // Drag to resize/expand
    function startResize(e) {
      e.preventDefault();
      isResizing = true;
      sidebar.classList.add('resizing');
      if (resizeHandle) resizeHandle.classList.add('active');
    }

    if (resizeHandle) resizeHandle.addEventListener('mousedown', startResize);
    if (minimizedIndicator) minimizedIndicator.addEventListener('mousedown', startResize);

    sidebar.querySelectorAll('.env-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const action = btn.dataset.action;
        const params = JSON.parse(btn.dataset.params || '{}');
        const cardId = btn.dataset.cardId;
        const card = btn.closest('.env-action');
        card.querySelectorAll('.env-btn').forEach(b => b.disabled = true);
        btn.innerHTML = '<span class="env-spinner"></span>';
        await executeAction(user, action, params, cardId, card);
      });
    });

    const input = sidebar.querySelector('#env-question');
    const sendBtn = sidebar.querySelector('#env-send');
    const conversation = sidebar.querySelector('#env-conversation');

    async function handleSubmit() {
      const question = input.value.trim();
      if (!question) return;
      input.value = '';
      sendBtn.disabled = true;

      // Replace content with user question and loading indicator
      conversation.innerHTML = `
        <div class="env-chat-msg user">${escapeHtml(question)}</div>
        <div class="env-typing" id="env-typing"><span></span><span></span><span></span></div>
      `;
      conversation.scrollTop = conversation.scrollHeight;

      try {
        const ctx = getContext();
        const res = await fetch(`${API_BASE}/api/ask`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user, question, context: buildApiContext(ctx) })
        });
        const data = await res.json();
        const answer = data.success ? data.answer : 'Sorry, something went wrong.';
        // Replace with user question and AI answer
        conversation.innerHTML = `
          <div class="env-chat-msg user">${escapeHtml(question)}</div>
          <div class="env-chat-msg assistant">${formatAnswer(answer)}</div>
        `;
        conversation.scrollTop = conversation.scrollHeight;
      } catch (err) {
        conversation.innerHTML = `
          <div class="env-chat-msg user">${escapeHtml(question)}</div>
          <div class="env-chat-msg assistant">Could not connect. Please try again.</div>
        `;
      }
      sendBtn.disabled = false;
      input.focus();
    }

    sendBtn.addEventListener('click', handleSubmit);
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSubmit(); });

    sidebar.querySelectorAll('.env-prompt').forEach(btn => {
      btn.addEventListener('click', () => {
        input.value = btn.textContent;
        handleSubmit();
      });
    });
  }

  async function executeAction(user, action, params, cardId, cardElement) {
    if (action === 'dismiss') {
      dismissedActions.push(params.action_id);
      saveDismissed();
      if (cardElement) {
        cardElement.style.transition = 'opacity 0.2s, transform 0.2s';
        cardElement.style.opacity = '0';
        cardElement.style.transform = 'translateX(20px)';
        setTimeout(() => cardElement.remove(), 200);
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

    try {
      const res = await fetch(`${API_BASE}/api/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, action, params })
      });
      const data = await res.json();
      if (data.success) {
        showModal(action, data.result, data.message, cardElement);
      } else {
        showModal(action, null, data.error || 'Something went wrong', cardElement, true);
      }
    } catch (err) {
      showModal(action, null, 'Could not connect to server', cardElement, true);
    }
  }

  function showModal(action, result, message, cardElement, isError = false) {
    const existing = document.getElementById('env-modal');
    if (existing) existing.remove();

    if (cardElement) {
      cardElement.querySelectorAll('.env-btn').forEach(btn => {
        btn.disabled = false;
        const labels = {
          'send_reminder': 'Send reminder',
          'extend_deadline': 'Extend deadline',
          'schedule_call': 'Schedule call',
          'find_similar': 'Find similar creators',
          'find_similar_creator': 'Find similar',
          'book_content': 'Book more content',
          'increase_budget': 'Increase budget',
          'pause_underperformers': 'Pause campaigns',
          'bulk_reminder': 'Request updates',
          'dismiss': 'Dismiss'
        };
        btn.textContent = labels[btn.dataset.action] || btn.dataset.action;
      });
    }

    let title = 'Result';
    let body = `<p>${escapeHtml(message)}</p>`;
    let footer = `<button class="env-modal-btn primary" onclick="document.getElementById('env-modal').remove()">Done</button>`;

    if (result?.type === 'reminder' && result.template) {
      title = `Message for ${result.creator?.name || 'Creator'}`;
      body = `<p>${escapeHtml(message)}</p><div class="env-modal-template">${escapeHtml(result.template)}</div>`;
      footer = `
        <button class="env-modal-btn secondary" onclick="document.getElementById('env-modal').remove()">Cancel</button>
        <button class="env-modal-btn primary" onclick="navigator.clipboard.writeText(document.querySelector('.env-modal-template').textContent); this.textContent='Copied!'; setTimeout(()=>this.textContent='Copy',1500);">Copy</button>
      `;
    }

    if (result?.type === 'recommendations' && result.suggestions) {
      title = `${result.platform} Recommendations`;
      body = `<p>${escapeHtml(message)}</p><div class="env-modal-template">${escapeHtml(result.suggestions)}</div>`;
    }

    if (result?.type === 'similar_creator_search' && result.suggestions) {
      title = `Similar to ${result.original}`;
      body = `<p>${escapeHtml(message)}</p><div class="env-modal-template">${escapeHtml(result.suggestions)}</div>`;
    }

    if (result?.type === 'calendar') {
      title = 'Schedule Call';
      footer = `
        <button class="env-modal-btn secondary" onclick="document.getElementById('env-modal').remove()">Cancel</button>
        <button class="env-modal-btn primary" onclick="window.open('${result.url}','_blank');document.getElementById('env-modal').remove();">Open Calendar</button>
      `;
    }

    if (result?.type === 'deadline_extended') {
      title = 'Deadline Extended';
      body = `<p>${escapeHtml(message)}</p><p style="margin-top:12px;padding:12px;background:#ECFDF5;border-radius:8px;color:#065F46;">New deadline: ${result.new_deadline}</p>`;
    }

    if (result?.type === 'help') {
      title = 'Help';
      body = result.content.split('\n').map(line => `<p>${escapeHtml(line)}</p>`).join('');
    }

    if (isError) {
      title = 'Error';
      body = `<p style="color:#DC2626;">${escapeHtml(message)}</p>`;
    }

    const modal = document.createElement('div');
    modal.id = 'env-modal';
    modal.className = 'env-modal';
    modal.innerHTML = `
      <div class="env-modal-box">
        <div class="env-modal-header">
          <h3>${title}</h3>
          <button class="env-modal-close" onclick="document.getElementById('env-modal').remove()">&times;</button>
        </div>
        <div class="env-modal-body">${body}</div>
        <div class="env-modal-footer">${footer}</div>
      </div>
    `;
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  }

  function init() {
    // Try to create sidebar
    if (!createSidebar()) {
      // If no user found, retry a few times (Softr may load user data async)
      let retries = 0;
      const maxRetries = 5;
      const retryInterval = setInterval(() => {
        retries++;
        if (createSidebar() || retries >= maxRetries) {
          clearInterval(retryInterval);
        }
      }, 500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
