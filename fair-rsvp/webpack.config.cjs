const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const path = require('path');
const BundleOutputPlugin = require('webpack-bundle-output');

const customConfig = {
	...defaultConfig,
	entry: () => {
		const defaultEntries =
			typeof defaultConfig.entry === 'function'
				? defaultConfig.entry()
				: defaultConfig.entry;

		return {
			...defaultEntries,
			'admin/events/index': path.resolve(
				process.cwd(),
				'src/Admin/events/index.js'
			),
			'admin/attendance/index': path.resolve(
				process.cwd(),
				'src/Admin/attendance/index.js'
			),
		};
	},
	plugins: [
		...defaultConfig.plugins,
		new BundleOutputPlugin({
			cwd: process.cwd(),
			output: 'map.json',
		}),
	],
};

module.exports = customConfig;
