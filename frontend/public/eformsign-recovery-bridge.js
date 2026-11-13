/* Trusted vendor scripts share this realm, not the application's parent realm.
 * Removing the outer iframe destroys it; CLOSE is only best-effort cleanup. */
(function () {
  'use strict';
  var channel = 'babyjamjam:eformsign-recovery';
  var origin = window.location.origin;
  var nonce = window.location.hash.slice(1);
  var active = window.parent !== window && origin !== 'null' && /^[a-f0-9]{64}$/.test(nonce) && nonce.length === 64;
  var closed = false;
  var started = false;
  var sdk = null;
  var provider = null;
  var scripts = [];

  function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  function keys(value, allowed) {
    return record(value) && Object.keys(value).length === allowed.length && allowed.every(function (key) {
      return Object.prototype.hasOwnProperty.call(value, key);
    });
  }
  function id(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !/\s/.test(value);
  }
  function emit(type) {
    if (active && !closed) window.parent.postMessage({ channel: channel, version: 1, nonce: nonce, type: type }, origin);
  }
  function close() {
    if (closed) return;
    closed = true;
    window.removeEventListener('message', parentMessage, true);
    window.removeEventListener('pagehide', close);
    scripts.forEach(function (script) {
      script.onload = null;
      script.onerror = null;
      script.remove();
    });
    scripts = [];
    if (provider) provider.remove();
    provider = null;
    if (sdk) {
      sdk._success_callback = null;
      sdk._error_callback = null;
      sdk._action_callback = null;
    }
    sdk = null;
    // Keep captureGuard installed in DENY-ALL state. Vendor listeners survive.
  }
  function fail() { emit('ERROR'); }
  function loadScript(src, next) {
    if (closed) return;
    var script = document.createElement('script');
    script.src = src;
    script.onload = function () {
      script.onload = null;
      script.onerror = null;
      if (!closed) next();
    };
    script.onerror = function () { if (!closed) { fail(); close(); } };
    scripts.push(script);
    document.head.appendChild(script);
  }
  function initialize(data) {
    provider = document.createElement('iframe');
    provider.id = 'eformsign-recovery-provider';
    provider.title = '전자문서 복구';
    provider.setAttribute('data-component', 'desktop_contracts_document-job-recovery_bridge_provider');
    provider.setAttribute('data-slot', 'provider-view');
    provider.setAttribute('data-source-component', 'EformsignRecoveryBridge');
    document.getElementById('provider-root').appendChild(provider);
    loadScript('https://www.eformsign.com/plugins/jquery/jquery.min.js', function () {
      loadScript('https://www.eformsign.com/lib/js/efs_embedded_v2.js', function () {
        try {
          sdk = new window.EformSignDocument();
          sdk.document({
            company: { id: data.companyId, country_code: 'kr' },
            mode: { type: '02', template_id: data.templateId, document_id: data.documentId },
            // SDK internal-viewer discriminator; no caller user or credentials.
            user: { type: '01' },
            layout: { lang_code: 'ko' }
          }, provider.id, function (result) {
            if (record(result) && result.code === '-1') emit('CHANGED');
          }, fail, function () { /* Provider actions grant no completion authority. */ });
          if (!closed) sdk.open();
        } catch { fail(); close(); }
      });
    });
  }
  function parentMessage(event) {
    if (event.source !== window.parent) return;
    event.stopImmediatePropagation();
    var data = event.data;
    if (!active || closed || event.origin !== origin || !record(data) || data.channel !== channel ||
        data.version !== 1 || data.nonce !== nonce) return;
    var base = ['channel', 'version', 'nonce', 'type'];
    if (data.type === 'CLOSE' && keys(data, base)) { close(); return; }
    if (data.type !== 'INIT' || started) return;
    if (!keys(data, base.concat(['companyId', 'templateId', 'documentId'])) ||
        !id(data.companyId) || !id(data.templateId) || !id(data.documentId)) { fail(); return; }
    started = true;
    try { initialize(data); } catch { fail(); close(); }
  }
  function supportedProviderMessage(data) {
    // Cached SDK messageController/handlers: only this mode02 flow is supported.
    // Callback payload fields ignored by this bridge never become parent state.
    switch (data.fn) {
      case 'isEmbedding':
        return data.message === undefined || record(data.message);
      case 'getTokenInfo':
        return data.message === undefined || (record(data.message) &&
          (data.message.role === undefined || data.message.role === null || typeof data.message.role === 'string'));
      case 'setStorage':
        return record(data.message) && typeof data.message.access_token === 'string' &&
          typeof data.message.refresh_token === 'string';
      case 'saveSuccess':
        return typeof data.code === 'string' && data.code.length > 0;
      case 'errorMessage':
        return typeof data.code === 'string' && data.code.length > 0 && typeof data.message === 'string';
      case 'actionCallback':
        // SDK passes data through; the bridge's action callback is a no-op.
        return Object.prototype.hasOwnProperty.call(data, 'data');
      case 'redirectMessage':
        // SDK replaces this realm's location, losing its guard and protocol.
        // Even an official URL is unsupported; account/login compatibility is unproven.
        fail();
        return false;
      default:
        // No configured user callbacks, batch mode, or recipient/header callbacks.
        return false;
    }
  }
  function captureGuard(event) {
    var valid = false;
    if (active && !closed && provider && event.origin === 'https://www.eformsign.com' &&
        event.source === provider.contentWindow && typeof event.data === 'string') {
      try {
        var data = JSON.parse(event.data);
        valid = record(data) && typeof data.fn === 'string' && data.fn.length > 0 &&
          (data.type === undefined || data.type === 'document');
        if (valid) valid = supportedProviderMessage(data);
      } catch { /* Malformed provider messages never reach vendor handlers. */ }
    }
    if (!valid) event.stopImmediatePropagation();
  }
  // Install both capture listeners before loading any vendor code.
  window.addEventListener('message', parentMessage, true);
  window.addEventListener('message', captureGuard, true);
  window.addEventListener('pagehide', close);
  emit('READY');
}());
