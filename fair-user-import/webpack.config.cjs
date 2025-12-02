const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const path = require('path');
const BundleOutputPlugin = require('webpack-bundle-output');

module.exports = {
	...defaultConfig,
	entry: {
		'admin/import-users/index': path.resolve(
			process.cwd(),
			'src/Admin/import-users/index.js'
		),
	},
	plugins: [
		...defaultConfig.plugins,
		new BundleOutputPlugin({
			cwd: process.cwd(),
			output: 'map.json',
		}),
	],
};
