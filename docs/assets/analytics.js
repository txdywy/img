import {openDialog, closeDialog} from './dialog.js?v=11';

// Set this to the Measurement ID of the production GA4 web stream.
const measurementId = 'G-E4XXBC3ML7';
const key = 'shiguang-analytics';
let enabled = false;
let started = false;

function preference() {
  try {
    const value = localStorage.getItem(key);
    return value === null ? null : value === 'on';
  } catch {
    return null;
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

function apply(choice) {
  enabled = choice;
  window['ga-disable-' + measurementId] = !enabled;
  if (enabled) start();
}

// Check the stored choice again before every event, so turning statistics off
// in one tab also stops events from tabs that are already open.
export function track(event) {
  if (!enabled) return;
  if (preference() === false) {
    apply(false);
    return;
  }
  window.gtag('event', event);
}

export function setupAnalytics() {
  if (!/^G-[A-Z0-9]+$/.test(measurementId) || location.hostname !== 'img.hackx64.eu.org') return;
  const button = document.querySelector('#analytics-open');
  const dialog = document.querySelector('#analytics-dialog');
  const choice = document.querySelector('#analytics-choice');
  apply(preference() === true);
  window.addEventListener('storage', event => {
    if (event.key === key) apply(event.newValue === 'on');
  });
  button.hidden = false;
  button.addEventListener('click', () => {
    choice.checked = enabled;
    openDialog(dialog, button);
  });
  document.querySelector('#analytics-save').addEventListener('click', () => {
    try {
      localStorage.setItem(key, choice.checked ? 'on' : 'off');
    } catch {
      // The choice still applies in this tab when storage is unavailable.
    }
    apply(choice.checked);
    closeDialog(dialog);
  });
}
