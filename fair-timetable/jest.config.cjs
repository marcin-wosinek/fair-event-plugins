module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/__tests__/**/*.test.js"],
  transformIgnorePatterns: [
    "/node_modules/(?!(uuid|@wordpress/components)/)",
  ],
  transform: {
    "^.+\\.js$": "babel-jest",
  },
  moduleNameMapper: {
    "^@utils/(.*)$": "<rootDir>/src/utils/$1",
    "^@models/(.*)$": "<rootDir>/src/models/$1",
  },
};