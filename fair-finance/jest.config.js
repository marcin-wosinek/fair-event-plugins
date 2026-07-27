export default {
	preset: '@wordpress/jest-preset-default',
	testEnvironment: 'jsdom',
	testMatch: [
		'**/__tests__/**/*.[jt]s?(x)',
		'**/?(*.)+(spec|test).[jt]s?(x)',
	],
	testPathIgnorePatterns: [
		'/node_modules/',
		'/vendor/',
		'/e2e/',
		'\\.api\\.spec\\.js$',
	],
	transformIgnorePatterns: [
		'/node_modules/(?!(uuid|@wordpress/components)/)',
	],
	collectCoverageFrom: [
		'src/**/*.js',
		'!src/**/index.js',
		'!**/node_modules/**',
		'!**/build/**',
		'!**/vendor/**',
		'!**/e2e/**',
	],
	coverageDirectory: 'coverage',
	coverageReporters: ['text', 'lcov', 'html'],
	setupFilesAfterEnv: [],
	transform: {
		'^.+\\.[jt]sx?$': [
			'babel-jest',
			{
				presets: [
					[
						'@babel/preset-env',
						{
							targets: {
								node: 'current',
							},
						},
					],
					['@babel/preset-react', { runtime: 'automatic' }],
				],
			},
		],
	},
	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1',
	},
};
