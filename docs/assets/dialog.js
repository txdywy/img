// Native <dialog> with a fallback for browsers without showModal().
const openers = new WeakMap();

function restore(dialog) {
  openers.get(dialog)?.focus({preventScroll: true});
  openers.delete(dialog);
}

export function openDialog(dialog, opener = document.activeElement) {
  openers.set(dialog, opener);
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
    return;
  }
  dialog.setAttribute('open', '');
  dialog.querySelector('[autofocus], button, a[href]')?.focus();
}

export function closeDialog(dialog) {
  if (typeof dialog.close === 'function') {
    dialog.close();
    return;
  }
  dialog.removeAttribute('open');
  restore(dialog);
}

for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('close', () => restore(dialog));
  for (const form of dialog.querySelectorAll('form[method="dialog"]')) {
    form.addEventListener('submit', event => {
      if (typeof dialog.close === 'function') return;
      event.preventDefault();
      closeDialog(dialog);
    });
  }
}
