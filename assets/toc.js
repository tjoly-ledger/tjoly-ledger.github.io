/* Highlights the section currently in view in a <nav class="toc">.
   The contents work as plain anchors without this file. */
(function () {
  var links = [].slice.call(document.querySelectorAll('.toc a'));
  if (!links.length) return;

  var ids = links.map(function (a) { return a.getAttribute('href').slice(1); });
  var LINE = 140;   /* the reading line, just below the sticky header */

  function scroller() { return document.scrollingElement || document.documentElement; }

  function pick() {
    var active = 0;
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el && el.getBoundingClientRect().top <= LINE) active = i;
    }
    /* The last section usually cannot push its own heading past the reading line
       before the page runs out of scroll, so it would never be selected. Once
       there is nothing left to scroll, it is the one being read. */
    var sc = scroller();
    if (sc.scrollHeight > sc.clientHeight + 4 &&
        sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) {
      active = ids.length - 1;
    }
    return active;
  }

  var shown = -1, queued = false;

  function sync() {
    queued = false;
    var i = pick();
    if (i === shown) return;
    shown = i;
    links.forEach(function (a, n) { a.classList.toggle('on', n === i); });
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }

  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  sync();
})();
