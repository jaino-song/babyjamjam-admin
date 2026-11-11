const { installed } = require('./installed.cjs');
module.exports = function sourceLoader(source) {
  // Preview-only redaction at compile time keeps source-template contacts out
  // of the generated artifact as well as the visible textarea. No repo edits.
  const previewSource = this.resourcePath.includes('/messages/templates/messageTemplate/')
    ? source.replace(/0\d{1,2}-\d{3,4}-\d{4}/g, '000-000-0000')
      .replace(/예금주: [^\r\n`]+/g, '예금주: QA-예시업체 (QA-예금주)')
    : source;
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
