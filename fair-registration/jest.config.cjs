module.exports = {
	testEnvironment: 'jsdom',
	transform: {
		'^.+\\.jsx?$': 'babel-jest',
	},
	moduleFileExtensions: ['js', 'jsx'],
	testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
	collectCoverageFrom: [
		'src/**/*.{js,jsx}',
		'!src/**/*.test.{js,jsx}',
		'!**/node_modules/**',
	],
};