const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const BundleOutputPlugin = require('webpack-bundle-output');

const defaultEntries =
	typeof defaultConfig.entry === 'function'
		? defaultConfig.entry()
		: defaultConfig.entry;

module.exports = {
	...defaultConfig,
	entry: () => ({
		...defaultEntries,
	}),
	plugins: [
		...defaultConfig.plugins,
		new BundleOutputPlugin({
			cwd: process.cwd(),
			output: 'map.json',
		}),
	],
};
