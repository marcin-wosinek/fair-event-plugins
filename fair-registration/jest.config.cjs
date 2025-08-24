module.exports = {
	testEnvironment: 'jsdom',
	transform: {
		'^.+\\.jsx?$': 'babel-jest',
	},
	moduleFileExtensions: ['js', 'jsx'],
	testMatch: ['<rootDir>/__tests__/**/*.js'],
	collectCoverageFrom: [
		'src/**/*.{js,jsx}',
		'!src/**/*.test.{js,jsx}',
		'!**/node_modules/**',
	],
};