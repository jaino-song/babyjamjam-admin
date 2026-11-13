const path = require('node:path');
const { installed, root } = require('./installed.cjs');
module.exports = function sourceLoader(source) {
  // Preview-only redaction at compile time keeps source-template contacts out
  // of the generated artifact as well as the visible textarea. No repo edits.
  let previewSource = this.resourcePath.includes('/messages/templates/messageTemplate/')
    ? source.replace(/0\d{1,2}-\d{3,4}-\d{4}/g, '000-000-0000')
      .replace(/예금주: [^\r\n`]+/g, '예금주: QA-예시업체 (QA-예금주)')
    : source;
  // The real bottom nav is compiled unchanged. Fail closed unless it still has
  // exactly one current canonical messages entry, so the preview cannot silently
  // drift from the product navigation contract.
  if (path.resolve(this.resourcePath) === path.join(root, 'mobile/src/components/app/root/mobile-bottom-nav.tsx')) {
    const entry = '{ href: "/messages", label: "메세지", icon: MessageSquareText, kind: "normal", slot: "mobile-bottom-nav-messages" }';
    if (source.split(entry).length !== 2) {
      throw new Error('Expected exactly one current MobileBottomNav messages entry (/messages, 메세지)');
    }
  }
  return installed('@swc/core').transformSync(previewSource, {
    filename: this.resourcePath,
    jsc: {
      parser: { syntax: 'typescript', tsx: this.resourcePath.endsWith('.tsx') },
      target: 'es2020',
      transform: { react: { runtime: 'automatic' } },
    },
    module: { type: 'es6' },
    sourceMaps: false,
  }).code;
};
