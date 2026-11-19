(function () {
  var $ = function (id) {
    return document.getElementById(id);
  };
  var KEY = 'seizure-log-v1';
  var eps = load();
  var cur = null;
  var timer = null;
  var audio = null;
  var wl = null;
  var stopArm = null;
  var clearArm = null;
  var chain = Promise.resolve();
  var FIXED = [45, 60, 120, 180, 240, 300];

  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(eps));
    } catch (e) {}
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    return Math.floor(sec / 60) + ':' + pad(sec % 60);
  }

  function tm(ms) {
    return new Date(ms).toLocaleTimeString('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function dt(ms) {
    return new Date(ms).toLocaleDateString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  function mapUrl(l) {
    return 'https://www.google.com/maps?q=' + l.lat + ',' + l.lon;
  }

  /* ---------- sound ---------- */
  function unlock() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) {}
  }

  function beep(n) {
    return new Promise(function (res) {
      if (!audio || n < 1) {
        res();
        return;
      }
      try {
        if (audio.state === 'suspended') audio.resume();
        var t = audio.currentTime + 0.05;
        for (var i = 0; i < n; i++) {
          var o = audio.createOscillator();
          var g = audio.createGain();
          o.type = 'square';
          o.frequency.value = 880;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
          o.connect(g);
          g.connect(audio.destination);
          o.start(t);
          o.stop(t + 0.32);
          t += 0.45;
        }
      } catch (e) {}
      setTimeout(res, n * 450 + 100);
    });
  }

  function say(text) {
    return new Promise(function (res) {
      if (!('speechSynthesis' in window)) {
        res();
        return;
      }
      var done = false;
      var f = function () {
        if (!done) {
          done = true;
          res();
        }
      };
      try {
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-AU';
        u.rate = 0.95;
        u.volume = 1;
        u.onend = f;
        u.onerror = f;
        setTimeout(f, 10000);
        speechSynthesis.speak(u);
      } catch (e) {
        f();
      }
    });
  }

  function announce(p) {
    return beep(p.b).then(function () {
      return say(p.text);
    });
  }

  /* ---------- milestones ---------- */
  function plan(s) {
    if (s === 45) return { text: '45 seconds', b: 0, lv: 'info' };
    if (s === 60) return { text: '1 minute, administer rescue medication', b: 1, lv: 'amber' };
    if (s === 300) {
      return {
        text: '5 minutes, administer second dose of rescue medication and call 000 immediately',
        b: 3,
        lv: 'red'
      };
    }
    var m = s / 60;
    return { text: m + ' minutes', b: 0, lv: m > 5 ? 'red' : 'info' };
  }

  function thresholds(el) {
    var list = FIXED.slice();
    for (var m = 6; m * 60 <= el; m++) list.push(m * 60);
    return list;
  }

  function fire(s) {
    var p = plan(s);
    cur.events.push({ s: s, t: cur.start + s * 1000, text: p.text, lv: p.lv });
    save();
    chain = chain.then(function () {
      return announce(p);
    });
    renderEvents();
  }

  function tick() {
    if (!cur) return;
    var el = (Date.now() - cur.start) / 1000;
    $('clock').textContent = fmt(el);
    $('fill').style.width = Math.min(100, (el / 300) * 100) + '%';
    thresholds(el).forEach(function (s) {
      if (el >= s && !cur.events.some(function (e) { return e.s === s; })) {
        fire(s);
      }
    });
  }

  /* ---------- screen, location ---------- */
  function wake() {
    try {
      if ('wakeLock' in navigator) {
        navigator.wakeLock.request('screen').then(function (l) {
          wl = l;
          sys();
        }).catch(function () {
          sys();
        });
      }
    } catch (e) {}
  }

  function sys() {
    var t = [];
    t.push(wl ? 'Screen will stay on.' : 'Keep your screen on.');
    t.push(audio ? 'Sound is on.' : 'Tap anywhere to turn sound on.');
    $('sysLine').textContent = t.join(' ');
  }

  function locate(ep) {
    if (!navigator.geolocation) {
      ep.locState = 'unavailable';
      save();
      renderLoc();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        ep.loc = {
          lat: +pos.coords.latitude.toFixed(6),
          lon: +pos.coords.longitude.toFixed(6),
          acc: pos.coords.accuracy,
          t: Date.now()
        };
        ep.locState = 'ok';
        save();
        renderLoc();
        renderList();
      },
      function (err) {
        ep.locState = err && err.code === 1 ? 'denied' : 'unavailable';
        save();
        renderLoc();
        renderList();
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  function locText(ep) {
    if (ep.loc) {
      return ep.loc.lat.toFixed(5) + ', ' + ep.loc.lon.toFixed(5) + ' (within ' + Math.round(ep.loc.acc) + ' m)';
    }
    if (ep.locState === 'denied') return 'Location blocked. Allow location for this page in your browser settings.';
    if (ep.locState === 'unavailable') return 'Location not available.';
    return 'Finding location…';
  }

  function renderLoc() {
    if (!cur) return;
    var el = $('locLine');
    el.textContent = '';
    el.appendChild(document.createTextNode(locText(cur) + ' '));
    if (cur.loc) {
      var a = document.createElement('a');
      a.href = mapUrl(cur.loc);
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Open map';
      el.appendChild(a);
    }
  }

  /* ---------- start / stop ---------- */
  function start() {
    unlock();
    if ('speechSynthesis' in window) {
      try {
        speechSynthesis.cancel();
        speechSynthesis.speak(new SpeechSynthesisUtterance(''));
      } catch (e) {}
    }
    var now = Date.now();
    cur = {
      id: now,
      start: now,
      end: null,
      loc: null,
      locState: 'pending',
      events: [{ s: 0, t: now, text: 'Started', lv: 'info' }]
    };
    eps.unshift(cur);
    save();
    chain = Promise.resolve();
    wake();
    locate(cur);
    timer = setInterval(tick, 250);
    showRunning();
  }

  function stop() {
    if (!cur) return;
    var now = Date.now();
    cur.end = now;
    cur.events.push({ s: (now - cur.start) / 1000, t: now, text: 'Ended', lv: 'info' });
    save();
    clearInterval(timer);
    timer = null;
    try {
      speechSynthesis.cancel();
    } catch (e) {}
    chain = Promise.resolve();
    try {
      if (wl) wl.release();
    } catch (e) {}
    wl = null;
    cur = null;
    $('stopBtn').textContent = 'Seizure ended';
    $('stopBtn').classList.remove('armed');
    showIdle();
  }

  function showRunning() {
    $('idle').hidden = true;
    $('running').hidden = false;
    $('startedAt').textContent = tm(cur.start) + ', ' + dt(cur.start);
    renderLoc();
    renderEvents();
    sys();
    tick();
    window.scrollTo(0, 0);
  }

  function showIdle() {
    $('idle').hidden = false;
    $('running').hidden = true;
    renderList();
  }

  /* ---------- rendering ---------- */
  function renderEvents() {
    if (!cur) return;
    var ul = $('events');
    ul.innerHTML = '';
    var last = null;
    cur.events.forEach(function (e) {
      if (e.s > 0 && e.text !== 'Ended') last = e;
      var li = document.createElement('li');
      var b = document.createElement('b');
      b.textContent = fmt(e.s);
      var s = document.createElement('span');
      s.textContent = e.text;
      var c = document.createElement('time');
      c.textContent = tm(e.t);
      li.appendChild(b);
      li.appendChild(s);
      li.appendChild(c);
      ul.appendChild(li);
    });
    var bn = $('banner');
    if (last) {
      bn.hidden = false;
      bn.className = 'banner ' + last.lv;
      bn.textContent = last.text.charAt(0).toUpperCase() + last.text.slice(1);
    } else {
      bn.hidden = true;
    }
  }

  function dur(ep) {
    return ep.end ? fmt((ep.end - ep.start) / 1000) : 'not stopped';
  }

  function endedText(ep) {
    return ep.end ? tm(ep.end) : ep === cur ? 'In progress' : 'Not stopped';
  }

  function doses(ep) {
    var el = ep.end ? (ep.end - ep.start) / 1000 : ep === cur ? (Date.now() - ep.start) / 1000 : 0;
    var maxEv = ep.events
      ? ep.events.reduce(function (m, e) {
          return e.s > m ? e.s : m;
        }, 0)
      : 0;
    var s = Math.max(el, maxEv);
    if (s >= 300) return 2;
    if (s >= 60) return 1;
    return 0;
  }

  function renderList() {
    var box = $('list');
    box.innerHTML = '';
    if (!eps.length) {
      var p = document.createElement('p');
      p.className = 'note';
      p.textContent = 'Nothing logged yet. Each seizure you time will appear here.';
      box.appendChild(p);
      return;
    }
    eps.forEach(function (ep) {
      var d = document.createElement('div');
      d.className = 'ep';
      var h = document.createElement('h3');
      h.textContent = dt(ep.start);
      d.appendChild(h);
      var pStart = document.createElement('p');
      pStart.textContent = 'Started: ' + tm(ep.start);
      d.appendChild(pStart);
      var pEnd = document.createElement('p');
      pEnd.textContent = 'Ended: ' + endedText(ep);
      d.appendChild(pEnd);
      var pLen = document.createElement('p');
      pLen.textContent = 'Length: ' + dur(ep);
      d.appendChild(pLen);
      var pLoc = document.createElement('p');
      pLoc.appendChild(document.createTextNode('Location: ' + locText(ep) + ' '));
      if (ep.loc) {
        var a = document.createElement('a');
        a.href = mapUrl(ep.loc);
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = 'Open map';
        pLoc.appendChild(a);
      }
      d.appendChild(pLoc);
      var pDoses = document.createElement('p');
      pDoses.textContent = 'Doses of rescue medicine: ' + doses(ep);
      d.appendChild(pDoses);
      box.appendChild(d);
    });
  }

  function summary() {
    return eps
      .map(function (ep) {
        return [
          dt(ep.start),
          'Started: ' + tm(ep.start),
          'Ended: ' + endedText(ep),
          'Length: ' + dur(ep),
          'Location: ' + (ep.loc ? locText(ep) + ' ' + mapUrl(ep.loc) : locText(ep)),
          'Doses of rescue medicine: ' + doses(ep)
        ].join('\n');
      })
      .join('\n\n');
  }

  function toast(t) {
    $('toast').textContent = t;
    setTimeout(function () {
      if ($('toast').textContent === t) $('toast').textContent = '';
    }, 4000);
  }

  /* ---------- wiring ---------- */
  $('startBtn').addEventListener('click', start);

  $('testBtn').addEventListener('click', function () {
    unlock();
    beep(1).then(function () {
      return say('Sound test. Beep and voice are working.');
    });
  });

  $('stopBtn').addEventListener('click', function () {
    var b = $('stopBtn');
    if (stopArm) {
      clearTimeout(stopArm);
      stopArm = null;
      stop();
      return;
    }
    b.textContent = 'Tap again to confirm';
    b.classList.add('armed');
    stopArm = setTimeout(function () {
      stopArm = null;
      b.textContent = 'Seizure ended';
      b.classList.remove('armed');
    }, 4000);
  });

  $('copyBtn').addEventListener('click', function () {
    if (!eps.length) {
      toast('Nothing to copy yet.');
      return;
    }
    var txt = summary();
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = txt;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        toast('Copied.');
      } catch (e) {
        toast('Could not copy.');
      }
    }
    try {
      navigator.clipboard.writeText(txt).then(
        function () {
          toast('Copied.');
        },
        fallback
      );
    } catch (e) {
      fallback();
    }
  });

  $('clearBtn').addEventListener('click', function () {
    if (cur) {
      toast('Stop the current timer first.');
      return;
    }
    if (!eps.length) return;
    var b = $('clearBtn');
    if (clearArm) {
      clearTimeout(clearArm);
      clearArm = null;
      b.textContent = 'Clear history';
      eps = [];
      save();
      renderList();
      toast('History cleared.');
      return;
    }
    b.textContent = 'Tap again to clear';
    clearArm = setTimeout(function () {
      clearArm = null;
      b.textContent = 'Clear history';
    }, 4000);
  });

  document.addEventListener('pointerdown', function () {
    if (!audio || audio.state === 'suspended') {
      unlock();
      if (cur) sys();
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && cur) {
      wake();
      tick();
    }
  });

  /* resume an unfinished timer after a reload */
  if (eps[0] && !eps[0].end && Date.now() - eps[0].start < 3 * 3600 * 1000) {
    cur = eps[0];
    timer = setInterval(tick, 250);
    showRunning();
  }
  renderList();
})();
