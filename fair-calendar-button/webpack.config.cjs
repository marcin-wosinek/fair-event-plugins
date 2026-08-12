const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const path = require('path');
const BundleOutputPlugin = require('webpack-bundle-output');

module.exports = {
	...defaultConfig,
	entry: {
		'blocks/calendar-button/editor': path.resolve(
			process.cwd(),
			'src/blocks/calendar-button/editor.js'
		),
		'blocks/calendar-button/frontend': path.resolve(
			process.cwd(),
			'src/blocks/calendar-button/frontend.js'
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
