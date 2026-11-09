module.exports = {
	preset: '@wordpress/jest-preset-default',
	testEnvironment: 'jsdom',
	testMatch: [ '**/?(*.)+(test).[jt]s?(x)' ],
	testPathIgnorePatterns: [ '/node_modules/', '/vendor/', '/build/' ],
	setupFiles: [ '<rootDir>/jest.setup.cjs' ],
	transformIgnorePatterns: [
		'/node_modules/(?!(uuid|@wordpress/components|@wordpress/dataviews|@wordpress/ui|@wordpress/theme)/)',
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
};
