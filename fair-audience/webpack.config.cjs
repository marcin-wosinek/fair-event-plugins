const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const path = require('path');
const BundleOutputPlugin = require('webpack-bundle-output');

// Get default entries
const defaultEntries =
	typeof defaultConfig.entry === 'function'
		? defaultConfig.entry()
		: defaultConfig.entry;

// Custom configuration
const customConfig = {
	...defaultConfig,
	entry: () => ({
		...defaultEntries,
		// Admin scripts
		'admin/all-participants/index': path.resolve(
			process.cwd(),
			'src/Admin/all-participants/index.js',
		),
		'admin/events-list/index': path.resolve(
			process.cwd(),
			'src/Admin/events-list/index.js',
		),
		'admin/event-participants/index': path.resolve(
			process.cwd(),
			'src/Admin/event-participants/index.js',
		),
		'admin/import/index': path.resolve(
			process.cwd(),
			'src/Admin/import/index.js',
		),
	}),
	plugins: [
		...defaultConfig.plugins,
		// Required for translation mapping
		new BundleOutputPlugin({
			cwd: process.cwd(),
			output: 'map.json',
		}),
	],
};

module.exports = customConfig;
