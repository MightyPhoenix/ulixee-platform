module.exports = {
  outputDir: '../../build/desktop/main/app/ui',
  filenameHashing: false,
  pages: {
    desktop: {
      title: 'Ulixee Desktop',
      entry: './src/pages/desktop/index.ts',
    },
    toolbar: {
      entry: './src/pages/toolbar/index.ts',
    },
    'menu-finder': {
      entry: './src/pages/menu-finder/index.ts',
    },
    'menu-primary': {
      entry: './src/pages/menu-primary/index.ts',
    },
    'menu-timetravel': {
      entry: './src/pages/menu-timetravel/index.ts',
    },
    'menu-url': {
      entry: './src/pages/menu-url/index.ts',
    },
    menubar: {
      entry: './src/pages/menubar/index.ts',
    },
    'screen-input': {
      title: 'Input Configuration',
      entry: './src/pages/screen-input/index.ts',
    },
    'screen-output': {
      title: 'Output',
      entry: './src/pages/screen-output/index.ts',
    },
    'screen-reliability': {
      title: 'Reliability Testing',
      entry: './src/pages/screen-reliability/index.ts',
    },
    'screen-about': {
      entry: './src/pages/screen-about/index.ts',
    },
    'extension/hero-script': {
      entry: `src/pages/extension/hero-script/index.ts`,
      template: 'public/extension.html',
    },
    'extension/state-generator': {
      entry: `src/pages/extension/state-generator/index.ts`,
      template: 'public/extension.html',
    },
    'extension/resources': {
      entry: `src/pages/extension/resources/index.ts`,
      template: 'public/extension.html',
    },
  },
  configureWebpack: config => {
    config.devtool = 'inline-source-map';
  },
  chainWebpack(config) {
    config.module
      .rule('vue')
      .use('vue-loader')
      .loader('vue-loader')
      .tap(options => {
        options.compilerOptions = options.compilerOptions || {};
        options.compilerOptions.whitespace = 'preserve'
        return options
      });
  }
};
