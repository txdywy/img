// Set this to the Measurement ID of the production GA4 web stream.
const measurementId = 'G-E4XXBC3ML7';
const key = 'shiguang-analytics';
let enabled = false;
let started = false;

function preference() {
  try {
    return localStorage.getItem(key) === 'on';
  } catch {
    return false;
  }
}

function start() {
  if (started) return;
  started = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', measurementId, {send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false});
  window.gtag('event', 'page_view', {page_location: location.origin + location.pathname, page_referrer: ''});
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
  document.head.append(script);
}

export function track(event) {
  if (enabled) window.gtag('event', event);
}

export function setupAnalytics() {
  if (!/^G-[A-Z0-9]+$/.test(measurementId) || location.hostname !== 'img.hackx64.eu.org') return;
  const button = document.querySelector('#analytics-open');
  const dialog = document.querySelector('#analytics-dialog');
  const choice = document.querySelector('#analytics-choice');
  enabled = preference();
  if (enabled) start();
  button.hidden = false;
  button.addEventListener('click', () => {
    choice.checked = enabled;
    dialog.showModal();
  });
  document.querySelector('#analytics-save').addEventListener('click', () => {
    enabled = choice.checked;
    window['ga-disable-' + measurementId] = !enabled;
    try {
      localStorage.setItem(key, enabled ? 'on' : 'off');
    } catch {
      // The choice still applies in this tab when storage is unavailable.
    }
    if (enabled) start();
    dialog.close();
  });
}
