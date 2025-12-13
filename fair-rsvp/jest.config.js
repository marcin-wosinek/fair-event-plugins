export default {
	preset: '@wordpress/jest-preset-default',
	testEnvironment: 'jsdom',

	testMatch: ['**/__tests__/**/*.test.js', '**/__tests__/**/*.test.jsx'],

	testPathIgnorePatterns: [
		'/node_modules/',
		'/vendor/',
		'/build/',
		'/svn/',
		'/e2e/',
		'/.api.spec.js$',
	],

	modulePathIgnorePatterns: ['<rootDir>/svn/'],

	transform: {
		'^.+\\.[jt]sx?$': [
			'babel-jest',
			{
				presets: [
					['@babel/preset-env', { targets: { node: 'current' } }],
					['@babel/preset-react', { runtime: 'automatic' }],
				],
			},
		],
	},

	collectCoverageFrom: [
		'src/**/*.{js,jsx}',
		'!src/**/index.js',
		'!src/**/__tests__/**',
		'!**/node_modules/**',
		'!**/build/**',
	],

	coverageDirectory: 'coverage',
	coverageReporters: ['text', 'lcov', 'html'],

	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1',
	},
};
