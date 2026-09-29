// Operation/session identifiers, not authentication credentials. Works on LAN HTTP.
(function (root) {
  let sequence = 0;
  function create() {
    if (typeof root.crypto?.randomUUID === 'function') return root.crypto.randomUUID();
    const random = typeof root.crypto?.getRandomValues === 'function'
      ? Array.from(root.crypto.getRandomValues(new Uint32Array(4)), n => n.toString(36)).join('_')
      : `${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    return `guest_${Date.now()}_${++sequence}_${random}`;
  }
  root.GameClientId = { create };
})(globalThis);
