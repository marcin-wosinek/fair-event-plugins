module.exports = {
	testEnvironment: 'jsdom',
	testMatch: [
		'<rootDir>/__tests__/**/*.test.js?(x)',
		'<rootDir>/src/**/__tests__/**/*.test.js?(x)',
	],
	transformIgnorePatterns: [
		'/node_modules/(?!(uuid|@wordpress/components|@wordpress/dataviews|@wordpress/ui|@wordpress/theme)/)',
	],
	transform: {
		'^.+\\.(m?js|jsx)$': 'babel-jest',
	},
};
