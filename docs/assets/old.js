// A plain script that even very old browsers run. If the main script could not
// start (an old iPhone, an old Android browser or an old WeChat), say so in plain
// words instead of showing buttons that do nothing.
(function () {
  function check() {
    if (window.frameAppReady) return;
    var note = document.getElementById('old-browser');
    if (!note) return;
    note.hidden = false;
    note.removeAttribute('hidden');
    document.documentElement.className += ' app-failed';
  }
  if (document.readyState === 'complete') setTimeout(check, 1500);
  else window.addEventListener('load', function () { setTimeout(check, 1500); });
})();
