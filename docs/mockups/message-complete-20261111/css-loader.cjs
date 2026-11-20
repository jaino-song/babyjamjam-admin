const { installed } = require('./installed.cjs');
module.exports = function cssLoader(source) {
  const done = this.async();
  const compile = async () => {
    let css = source;
    if (this.resourcePath.endsWith('/app/globals.css')) {
      const result = await installed('postcss')([
        installed('@tailwindcss/postcss')({ base: this.rootContext, optimize: false }),
      ]).process(css, { from: this.resourcePath });
      css = result.css;
      for (const message of result.messages) {
        if (message.type === 'dependency' && message.file) this.addDependency(message.file);
      }
    }
    const result = installed('lightningcss').transform({
      filename: this.resourcePath,
      code: Buffer.from(css),
      cssModules: this.resourcePath.endsWith('.module.css') ? { pattern: '[name]_[local]_[hash]' } : false,
      minify: false,
    });
    const classes = Object.fromEntries(Object.entries(result.exports || {}).map(([name, info]) => [name, info.name]));
    // textContent is intentional: CSS comes only from reviewed local source files.
    return `const style = document.createElement('style'); style.textContent = ${JSON.stringify(result.code.toString())}; document.head.append(style); export default ${JSON.stringify(classes)};`;
  };
  compile().then(code => done(null, code), done);
};
