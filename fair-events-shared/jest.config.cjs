module.exports = {
	testEnvironment: 'jsdom',
	testMatch: [
		'<rootDir>/__tests__/**/*.test.js',
		'<rootDir>/src/**/__tests__/**/*.test.js',
	],
	transformIgnorePatterns: [
		'/node_modules/(?!(uuid|@wordpress/components)/)',
	],
	transform: {
		'^.+\\.js$': 'babel-jest',
	},
};
