const fs = require('node:fs');
const path = require('node:path');
const { installed, root } = require('./installed.cjs');
const webpack = installed('webpack');
const dir = __dirname;
const mobile = path.join(root, 'mobile');
const adapters = {
  'next/navigation$': path.join(dir, 'navigation.ts'),
  'next/link$': path.join(dir, 'link.tsx'),
  '@/providers/UserProvider$': path.join(dir, 'identity.ts'),
  '@/components/app/notifications/NotificationBell$': path.join(dir, 'notification.tsx'),
};
webpack({
  mode: 'production',
  context: mobile,
  entry: path.join(dir, 'preview.tsx'),
  output: { path: path.join(dir, 'dist'), filename: 'preview.js', clean: true },
  devtool: false,
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
    alias: { ...adapters, '@': path.join(mobile, 'src') },
    modules: [path.join(mobile, 'node_modules'), path.join(root, 'node_modules'), 'node_modules'],
  },
  module: { rules: [
    { test: /\.tsx?$/, use: path.join(dir, 'source-loader.cjs') },
    { test: /\.css$/, use: path.join(dir, 'css-loader.cjs') },
  ] },
  performance: false,
  optimization: { minimize: true },
}, (error, stats) => {
  if (error || stats.hasErrors()) {
    process.stderr.write(`${error || stats.toString({ all: false, errors: true, errorDetails: true })}\n`);
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(path.join(dir, 'dist/assets'), { recursive: true });
  fs.copyFileSync(path.join(mobile, 'src/app/fonts/Pretendard.woff2'), path.join(dir, 'dist/assets/Pretendard.woff2'));
  process.stdout.write(`${stats.toString({ all: false, assets: true, timings: true, warnings: true })}\n`);
  process.stdout.write('Static preview: docs/mockups/message-complete-20261111/index.html\n');
});
