// Envisioner Context Tracker
// Add this to Softr's global header custom code
(function() {
  const ENV_KEY = 'envisioner_context';

  // Get or initialize context
  function getContext() {
    try {
      return JSON.parse(sessionStorage.getItem(ENV_KEY)) || {
        currentPage: null,
        previousPage: null,
        viewing: null,
        actions: [],
        pageViews: [],
        startTime: Date.now()
      };
    } catch {
      return { currentPage: null, previousPage: null, viewing: null, actions: [], pageViews: [], startTime: Date.now() };
    }
  }

  // Save context
  function saveContext(ctx) {
    sessionStorage.setItem(ENV_KEY, JSON.stringify(ctx));
  }

  // Detect what record user is viewing from URL or page content
  function detectViewing() {
    const url = window.location.href;
    const path = window.location.pathname;

    // Check URL parameters (Softr often uses ?recordId=xxx)
    const params = new URLSearchParams(window.location.search);
    const recordId = params.get('recordId') || params.get('id');

    // Try to get name from page title or first h1
    let viewingName = null;
    const h1 = document.querySelector('h1');
    if (h1 && h1.textContent.trim()) {
      viewingName = h1.textContent.trim();
    }

    return {
      recordId,
      name: viewingName,
      page: path
    };
  }

  // Get page name from path
  function getPageName(path) {
    const pages = {
      '/dashboard': 'Dashboard',
      '/campaigns': 'Campaigns',
      '/influencers': 'Influencers',
      '/deliverables': 'Deliverables',
      '/conversions': 'Conversions'
    };
    return pages[path] || path.replace(/\//g, '') || 'Home';
  }

  // Track page view
  function trackPageView() {
    const ctx = getContext();
    const path = window.location.pathname;
    const pageName = getPageName(path);

    // Update previous/current page
    if (ctx.currentPage && ctx.currentPage !== path) {
      ctx.previousPage = ctx.currentPage;
    }
    ctx.currentPage = path;

    // Add to page views (keep last 10)
    ctx.pageViews.push({
      page: pageName,
      path: path,
      time: Date.now()
    });
    if (ctx.pageViews.length > 10) ctx.pageViews.shift();

    // Detect what they're viewing
    setTimeout(() => {
      const viewing = detectViewing();
      if (viewing.name || viewing.recordId) {
        ctx.viewing = viewing;
        saveContext(ctx);
      }
    }, 500); // Wait for page to render

    saveContext(ctx);
  }

  // Track clicks on important elements
  function trackClicks() {
    document.addEventListener('click', (e) => {
      const target = e.target.closest('a, button, [role="button"], [data-track]');
      if (!target) return;

      const ctx = getContext();
      const text = target.textContent?.trim().slice(0, 50) || '';
      const href = target.href || '';

      // Skip tracking the AI widget itself
      if (target.closest('#envisioner-widget')) return;

      ctx.actions.push({
        type: 'click',
        text: text,
        href: href,
        page: getPageName(window.location.pathname),
        time: Date.now()
      });

      // Keep last 10 actions
      if (ctx.actions.length > 10) ctx.actions.shift();

      saveContext(ctx);
    });
  }

  // Initialize
  function init() {
    trackPageView();
    trackClicks();

    // Track navigation (for SPAs)
    let lastPath = window.location.pathname;
    setInterval(() => {
      if (window.location.pathname !== lastPath) {
        lastPath = window.location.pathname;
        trackPageView();
      }
    }, 500);
  }

  // Expose for the widget to read
  window.getEnvisionerContext = getContext;

  // Start tracking
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
