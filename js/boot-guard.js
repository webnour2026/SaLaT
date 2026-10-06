// Garde-fou de démarrage : si le script principal ne démarre pas en 5 s, on propose de vider le cache.
// (Fichier séparé pour que la politique de sécurité (CSP) puisse interdire tout script inline.)
setTimeout(function () {
  if (window.__appStarted) return;
  var box = document.getElementById('bootFail'); box.hidden = false; document.body.classList.remove('booting');
  document.getElementById('bootFix').onclick = async function () {
    try {
      if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    } catch (e) {}
    location.reload();
  };
}, 5000);
