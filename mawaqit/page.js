// Pages des villes : horaire du jour, prochaine prière et compte à rebours ; recherche dans la liste des villes.
// Heure légale du Maroc = GMT : les heures du tableau sont en UTC.
(function () {
  var q = document.getElementById('q');
  if (q) q.addEventListener('input', function () {
    var v = q.value.trim().toLowerCase();
    document.querySelectorAll('#cities li').forEach(function (li) { li.hidden = v && li.textContent.toLowerCase().indexOf(v) < 0; });
  });
  var el = document.getElementById('data'); if (!el) return;
  var days = JSON.parse(el.textContent).days, AR = ['الفجر', 'الشروق', 'الظهر', 'العصر', 'المغرب', 'العشاء'];
  var ms = function (d, s) { return Date.parse(d + 'T' + s.slice(0, 2) + ':' + s.slice(2) + ':00Z'); };
  function tick() {
    var now = Date.now(), key = new Date(now).toISOString().slice(0, 10), i = -1;
    for (var k = 0; k < days.length; k++) if (days[k][0] === key) i = k;
    if (i < 0) return;
    var t = days[i][1].split(' '), next = null;
    for (var j = 0; j < 6 && !next; j++) if (j !== 1 && ms(key, t[j]) > now) next = [j, ms(key, t[j])];
    if (!next && days[i + 1]) next = [0, ms(days[i + 1][0], days[i + 1][1].split(' ')[0])];
    document.getElementById('today').hidden = false;
    document.getElementById('tDate').textContent = new Intl.DateTimeFormat('ar-MA-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(now);
    document.getElementById('tGrid').innerHTML = t.map(function (s, j) {
      var on = next && next[0] === j && new Date(next[1]).toISOString().slice(0, 10) === key;   // prochaine prière (aujourd'hui)
      return '<li' + (on ? ' class="on"' : '') + '>' + AR[j] + '<b>' + s.slice(0, 2) + ':' + s.slice(2) + '</b></li>';
    }).join('');
    if (next) {
      var left = Math.max(0, Math.round((next[1] - now) / 1000)), h = Math.floor(left / 3600), m = Math.floor(left % 3600 / 60), sec = left % 60;
      document.getElementById('nName').textContent = 'الصلاة القادمة: ' + AR[next[0]];
      document.getElementById('nTime').textContent = new Date(next[1]).toISOString().slice(11, 16);
      document.getElementById('nLeft').textContent = 'بعد ' + (h ? h + ' س ' : '') + m + ' د ' + sec + ' ث';
    }
    var row = document.querySelector('tr[data-d="' + key + '"]'); if (row && !row.classList.contains('on')) row.classList.add('on');
  }
  tick(); setInterval(tick, 1000);
})();
