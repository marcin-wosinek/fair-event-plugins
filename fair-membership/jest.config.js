/**
 * Jest configuration for Fair Membership plugin
 *
 * @package FairMembership
 */

export default {
	preset: '@wordpress/jest-preset-default',
	testEnvironment: 'jsdom',
	testMatch: [
		'**/__tests__/**/*.js',
		'**/?(*.)+(spec|test).js'
	],
	collectCoverageFrom: [
		'src/**/*.js',
		'!src/**/index.js',
		'!**/node_modules/**',
		'!**/build/**',
		'!**/vendor/**'
	],
	coverageDirectory: 'coverage',
	coverageReporters: [
		'text',
		'lcov',
		'html'
	],
	setupFilesAfterEnv: [],
	transform: {
		'^.+\\.[jt]sx?$': ['babel-jest', {
			presets: [
				['@babel/preset-env', {
					targets: {
						node: 'current'
					}
				}]
			]
		}]
	},
	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1'
	}
};