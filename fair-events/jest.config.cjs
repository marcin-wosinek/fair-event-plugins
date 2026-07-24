module.exports = {
	preset: '@wordpress/jest-preset-default',
	testEnvironment: 'jsdom',
	testMatch: ['**/?(*.)+(test).[jt]s?(x)'],
	testPathIgnorePatterns: ['/node_modules/', '/vendor/', '/build/', '/e2e/'],
	transformIgnorePatterns: [
		'/node_modules/(?!(uuid|@wordpress/components|@wordpress/dataviews|@wordpress/ui|@wordpress/theme)/)',
	],
	transform: {
		'^.+\\.(mjs|[jt]sx?)$': [
			'babel-jest',
			{
				presets: [
					['@babel/preset-env', { targets: { node: 'current' } }],
					['@babel/preset-react', { runtime: 'automatic' }],
				],
			},
		],
	},
};
