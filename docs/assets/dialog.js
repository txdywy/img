// Native <dialog> with a fallback for browsers without showModal(), plus the
// phone Back button: every open window or sheet adds a history entry, so Back
// closes it instead of leaving the page.
const openers = new WeakMap();
const layers = [];
let ownBacks = 0;

// Call when a sheet or window opens; close() runs if Back is pressed.
export function pushLayer(close) {
  const layer = {close};
  layers.push(layer);
  try {
    history.pushState({frameLayer: layers.length}, '');
  } catch {
    // Some embedded browsers refuse history changes; Back then just leaves.
  }
  return layer;
}

// Call when a sheet or window closes some other way (a button, Esc, a tap outside).
export function releaseLayer(layer) {
  const index = layers.indexOf(layer);
  if (index < 0) return;
  layers.splice(index, 1);
  if (history.state?.frameLayer) {
    ownBacks++;
    history.back();
  }
}

window.addEventListener('popstate', () => {
  if (ownBacks) {
    ownBacks--;
    return;
  }
  layers.pop()?.close();
});

function restore(dialog) {
  openers.get(dialog)?.focus({preventScroll: true});
  openers.delete(dialog);
}

export function openDialog(dialog, opener = document.activeElement) {
  openers.set(dialog, opener);
  dialog.layer = pushLayer(() => closeDialog(dialog));
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
    return;
  }
  dialog.setAttribute('open', '');
  dialog.querySelector('[autofocus], button, a[href]')?.focus();
}

export function closeDialog(dialog) {
  if (typeof dialog.close === 'function') {
    if (dialog.open) dialog.close();
    return;
  }
  if (!dialog.hasAttribute('open')) return;
  dialog.removeAttribute('open');
  dialog.dispatchEvent(new Event('close'));
}

for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('close', () => {
    releaseLayer(dialog.layer);
    dialog.layer = null;
    restore(dialog);
  });
  for (const form of dialog.querySelectorAll('form[method="dialog"]')) {
    form.addEventListener('submit', event => {
      if (typeof dialog.close === 'function') return;
      event.preventDefault();
      closeDialog(dialog);
    });
  }
}
