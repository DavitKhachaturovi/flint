// The site's screen videos: one pass of play(w), padded to LEN ms; the site sends 'flint-play' each
// time the tab shows. Opened on its own, it loops.
window.flintPlayer = function (LEN, reset, play) {
  var run = 0;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function start(loop) {
    var t = ++run, t0 = Date.now();
    var w = function (ms) { return sleep(ms).then(function () { if (t !== run) throw 0; }); };
    reset();
    play(w).then(function () { if (window.parent !== window) window.parent.postMessage('flint-done', '*'); return w(Math.max(0, LEN - (Date.now() - t0))); }).then(function () { if (loop && t === run) start(true); }, function () {});
  }
  window.addEventListener('message', function (e) { if (e.data === 'flint-play') start(false); });
  start(window.parent === window);
};
window.flintCursor = function (cur, el, dx, dy) {
  var r = el.getBoundingClientRect();
  cur.style.left = (r.left + (dx == null ? r.width / 2 : dx)) + 'px';
  cur.style.top = (r.top + (dy == null ? r.height / 2 : dy)) + 'px';
};
