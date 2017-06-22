module.exports = (wallaby) => ({
  name: 'redux-persist-transform-passwords',

  files: [
    'src/**/*.js'
  ],

  tests: [
    'test/**/*.js'
  ],

  env: {
    type: 'node',
    runner: 'node',
    params: { env: 'wallaby=true' }
  },

  testFramework: 'jest',

  compilers: {
    '**/*.js': wallaby.compilers.babel()
  }
});
