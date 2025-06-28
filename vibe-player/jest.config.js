// jest.config.js
module.exports = {
  testEnvironment: 'jsdom', // Using 'jsdom' as global install should be in PATH

  setupFilesAfterEnv: ['./jest.setup.js'],

  testMatch: [
    "**/tests/unit/**/*.test.js"
  ]
};
