// flintnotes.app/join (SPACE-06, D-189 Q6, D-190 Q8): the link in a space's invite e-mail. It
// reads the part after # (browsers never send it to a server, so this site never learns which
// space), checks it has the shape of a join link, and hands it to Flint as flint://join?… (or
// flint-dev://join?… for a development build's invite). Flint checks it again and asks before
// joining; this page decides nothing. The same rules as core's join-link.ts.
(function () {
  'use strict';
  var DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;

  function readParams(query) {
    var params = {};
    var parts = query.split('&');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '') continue;
      var equals = parts[i].indexOf('=');
      var key, value;
      try {
        key = decodeURIComponent((equals === -1 ? parts[i] : parts[i].slice(0, equals)).replace(/\+/g, ' '));
        value = decodeURIComponent((equals === -1 ? '' : parts[i].slice(equals + 1)).replace(/\+/g, ' '));
      } catch {
        return null;
      }
      if (Object.prototype.hasOwnProperty.call(params, key)) return null;
      params[key] = value;
    }
    return params;
  }

  function cleanName(raw) {
    var cleaned = '';
    for (var i = 0; i < raw.length; i++) {
      var code = raw.charCodeAt(i);
      if (code === 9 || code === 10 || code === 13) cleaned += ' ';
      else if (code < 32 || (code >= 127 && code < 160)) continue;
      else if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) continue;
      else cleaned += raw.charAt(i);
    }
    return Array.from(cleaned.replace(/\s+/g, ' ').trim()).slice(0, 60).join('');
  }

  function parse(hash) {
    var params = readParams(hash.replace(/^#/, ''));
    if (!params || typeof params.g !== 'string') return null;
    var ids = params.g.split('.');
    if (ids.length !== 2 || !DRIVE_ID.test(ids[0]) || !DRIVE_ID.test(ids[1]) || ids[0] === ids[1])
      return null;
    var name = cleanName(params.n || '');
    if (name === '') return null;
    if (params.d !== undefined && params.d !== '1') return null;
    return { spaceFile: ids[0], filesFile: ids[1], name: name, development: params.d === '1' };
  }

  function start() {
    var title = document.getElementById('join-title');
    var line = document.getElementById('join-line');
    var actions = document.getElementById('join-actions');
    var open = document.getElementById('join-open');
    var request = parse(window.location.hash);
    if (!request) {
      title.textContent = 'This isn’t a Flint invite link';
      line.textContent =
        'The link may have been cut off by your mail app. Open the invite e-mail again, or ask for a new invite.';
      return;
    }
    var app =
      (request.development ? 'flint-dev' : 'flint') +
      '://join?g=' +
      request.spaceFile +
      '.' +
      request.filesFile +
      '&n=' +
      encodeURIComponent(request.name) +
      (request.development ? '&d=1' : '');
    title.textContent = 'Opening Flint to join ' + request.name;
    open.setAttribute('href', app);
    actions.hidden = false;
    window.location.href = app;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
