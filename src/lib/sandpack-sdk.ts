// atoms-sdk.js — injected into every Sandpack project as /atoms-sdk.js (hidden).
//
// Why this exists: the Sandpack preview iframe is cross-origin (codesandbox.io
// in dev, our own static host in prod). A direct fetch('/api/...') from inside
// the iframe would CORS-fail. So we ship a tiny SDK that exposes
// `window.atomsDb` to user code and proxies every call to the parent page via
// postMessage. The parent (AppViewer) listens for { kind: 'atoms-db', ... } and
// forwards to POST /api/projects/:id/db/run.
//
// Keep this file PURE INLINE JS — no imports, no exports inside the template
// literal, plain ES2018 syntax (Sandpack static template runs the file
// untouched).

export const ATOMS_SDK_JS = `(function(){
  if (typeof window === 'undefined') return;

  // Standalone preview (no parent) → no-op stubs so user code doesn't crash.
  if (window.parent === window) {
    var noop = function(){
      return Promise.resolve({ ok: false, error: 'atomsDb: no parent bridge (standalone preview)' });
    };
    window.atomsDb = {
      query: noop,
      exec: noop,
      allTables: function(){ return Promise.resolve([]); }
    };
    console.log('[atoms-sdk] standalone preview · window.atomsDb is no-op');
    return;
  }

  var pending = Object.create(null);
  var TIMEOUT_MS = 10000;

  function newReqId(){
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (_) {}
    return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function send(op, sql, params){
    var reqId = newReqId();
    return new Promise(function(resolve, reject){
      var timer = setTimeout(function(){
        if (pending[reqId]) {
          delete pending[reqId];
          reject(new Error('atomsDb: timeout'));
        }
      }, TIMEOUT_MS);
      pending[reqId] = { resolve: resolve, reject: reject, timer: timer };
      try {
        window.parent.postMessage(
          { kind: 'atoms-db', op: op, sql: sql, params: params, reqId: reqId },
          '*'
        );
      } catch (e) {
        clearTimeout(timer);
        delete pending[reqId];
        reject(e);
      }
    });
  }

  window.addEventListener('message', function(ev){
    var data = ev.data;
    if (!data || data.kind !== 'atoms-db-result' || !data.reqId) return;
    var entry = pending[data.reqId];
    if (!entry) return;
    delete pending[data.reqId];
    clearTimeout(entry.timer);
    if (data.error) {
      entry.reject(new Error(String(data.error)));
    } else {
      entry.resolve(data.data);
    }
  });

  window.atomsDb = {
    query: function(sql, params){ return send('query', sql, params); },
    exec:  function(sql, params){ return send('exec',  sql, params); },
    allTables: function(){
      return send('query', "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", undefined)
        .then(function(res){
          if (!res || res.ok === false) return [];
          var rows = res.rows || [];
          var out = [];
          for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (!r) continue;
            // rows are objects keyed by column name (post-F4 shape).
            if (r.name) out.push(String(r.name));
          }
          return out;
        });
    }
  };

  console.log('[atoms-sdk] ready · window.atomsDb available');
})();
`;
