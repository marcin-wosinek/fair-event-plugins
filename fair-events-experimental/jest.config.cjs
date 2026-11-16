module.exports = {
	preset: '@wordpress/jest-preset-default',
	testEnvironment: 'jsdom',
	testMatch: [ '**/?(*.)+(test).[jt]s?(x)' ],
	moduleNameMapper: {
		// Entry points import shared styles with a `?query` so each webpack
		// entry gets its own copy; the preset only maps plain `.css` paths.
		'\\.(scss|css)\\?.*$':
			'<rootDir>/../node_modules/@wordpress/jest-preset-default/scripts/style-mock.js',
	},
	testPathIgnorePatterns: [ '/node_modules/', '/vendor/', '/build/' ],
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
