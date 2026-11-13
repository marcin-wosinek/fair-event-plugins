module.exports = {
	preset: '@wordpress/jest-preset-default',
	testEnvironment: 'jsdom',
	testMatch: [ '**/__tests__/**/*.test.js?(x)' ],
	testPathIgnorePatterns: [
		'/node_modules/',
		'/vendor/',
		'/build/',
		'/svn/',
		'/e2e/',
		'\\.api\\.spec\\.js$',
	],
	transformIgnorePatterns: [
		'/node_modules/(?!(uuid|@wordpress/components|@wordpress/ui|@wordpress/theme)/)',
	],
	transform: {
		'^.+\\.m?[jt]sx?$': [
			'babel-jest',
			{
				presets: [
					[ '@babel/preset-env', { targets: { node: 'current' } } ],
					[ '@babel/preset-react', { runtime: 'automatic' } ],
				],
			},
		],
	},
	collectCoverageFrom: [
		'src/**/*.js',
		'!src/**/__tests__/**',
		'!src/**/index.js',
	],
};
