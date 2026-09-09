/**
 * Tadoru browser tracker.
 *
 * Loaded as:
 *   <script defer src="https://tadoru.example.com/t.js" data-site="example.com"></script>
 *
 * Everything it collects is behavioural. It reads no canvas, no WebGL, no font
 * list, no timezone, no exact resolution and no plugin list. The payload schema
 * in payload.ts is a closed allow-list, and a test enforces that.
 */
import { shouldTrack } from './consent.ts';
import {
  buildPageviewPayload,
  newlyCrossedMilestones,
  createEngagementTimer,
  type Payload,
} from './payload.ts';

(function tadoru(): void {
  const script = document.currentScript as HTMLScriptElement | null;
  if (!script) return;

  const endpoint = script.getAttribute('data-endpoint') ?? new URL(script.src).origin + '/api/event';

  if (
    !shouldTrack({
      doNotTrack:
        navigator.doNotTrack ??
        (window as unknown as { doNotTrack?: string }).doNotTrack ??
        null,
      globalPrivacyControl: (navigator as unknown as { globalPrivacyControl?: boolean })
        .globalPrivacyControl,
      hostname: location.hostname,
      protocol: location.protocol,
      visibilityState: document.visibilityState,
    })
  ) {
    return;
  }

  const send = (payload: Payload, viaBeacon = false): void => {
    const body = JSON.stringify(payload);
    // sendBeacon survives the page unloading; fetch does not.
    if (viaBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
      return;
    }
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      /* Analytics must never break the host page. */
    });
  };

  const pageContext = () => ({
    href: location.href,
    referrer: document.referrer,
    screenWidth: window.innerWidth,
    colorScheme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    lang: navigator.language,
  });

  let deepestScroll = 0;
  let engagement = createEngagementTimer(() => Date.now());
  let currentPath = '';

  const flushEngagement = (): void => {
    const seconds = engagement.visibleSeconds();
    if (seconds <= 0) return;
    send({ type: 'engagement', path: currentPath, value: seconds }, true);
  };

  const trackPageview = (): void => {
    const payload = buildPageviewPayload(pageContext());
    if (payload.path === currentPath) return;
    currentPath = payload.path;
    deepestScroll = 0;
    engagement = createEngagementTimer(() => Date.now());
    send(payload);
  };

  // --- SPA route changes -----------------------------------------------------
  const wrapHistory = (method: 'pushState' | 'replaceState'): void => {
    const original = history[method];
    history[method] = function patched(this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args);
      flushEngagement();
      trackPageview();
      return result;
    };
  };
  wrapHistory('pushState');
  wrapHistory('replaceState');
  addEventListener('popstate', () => {
    flushEngagement();
    trackPageview();
  });

  // --- Scroll depth ----------------------------------------------------------
  addEventListener(
    'scroll',
    () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;
      const percent = Math.min(100, Math.round(((window.scrollY || 0) / scrollable) * 100));
      for (const milestone of newlyCrossedMilestones(deepestScroll, percent)) {
        send({ type: 'custom', path: currentPath, name: 'scroll', value: milestone });
      }
      if (percent > deepestScroll) deepestScroll = percent;
    },
    { passive: true },
  );

  // --- Outbound links and downloads -----------------------------------------
  const DOWNLOAD_EXTENSIONS =
    /\.(pdf|zip|rar|7z|tar|gz|dmg|exe|pkg|csv|xlsx?|docx?|pptx?|mp3|mp4|mov)$/i;

  addEventListener(
    'click',
    (event) => {
      const anchor = (event.target as Element | null)?.closest?.('a');
      if (!anchor || !anchor.href) return;
      let url: URL;
      try {
        url = new URL(anchor.href);
      } catch {
        return;
      }
      if (url.hostname !== location.hostname) {
        send({ type: 'outbound', path: currentPath, name: url.hostname }, true);
      } else if (DOWNLOAD_EXTENSIONS.test(url.pathname)) {
        send({ type: 'custom', path: currentPath, name: 'download', props: { file: url.pathname } });
      }
    },
    { capture: true, passive: true },
  );

  // --- Engagement ------------------------------------------------------------
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      engagement.hide();
      flushEngagement();
    } else {
      engagement.show();
    }
  });
  addEventListener('pagehide', flushEngagement);

  // --- Core Web Vitals -------------------------------------------------------
  const observe = (type: string, handler: (entries: PerformanceEntryList) => void): void => {
    try {
      new PerformanceObserver((list) => handler(list.getEntries())).observe({
        type,
        buffered: true,
      });
    } catch {
      /* Unsupported in this browser; vitals are optional. */
    }
  };

  let clsValue = 0;
  observe('layout-shift', (entries) => {
    for (const entry of entries as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
      if (!entry.hadRecentInput) clsValue += entry.value;
    }
  });
  observe('largest-contentful-paint', (entries) => {
    const last = entries[entries.length - 1];
    if (last) send({ type: 'vitals', path: currentPath, name: 'LCP', value: Math.round(last.startTime) });
  });
  observe('event', (entries) => {
    for (const entry of entries) {
      if (entry.duration >= 200) {
        send({ type: 'vitals', path: currentPath, name: 'INP', value: Math.round(entry.duration) });
        break;
      }
    }
  });
  addEventListener('pagehide', () => {
    if (clsValue > 0) {
      send({ type: 'vitals', path: currentPath, name: 'CLS', value: Math.round(clsValue * 1000) }, true);
    }
  });

  // --- Public API for goals --------------------------------------------------
  (window as unknown as Record<string, unknown>)['tadoru'] = (
    name: string,
    props?: Record<string, unknown>,
  ): void => {
    send({ type: 'custom', path: currentPath, name, ...(props ? { props } : {}) });
  };

  trackPageview();
})();
