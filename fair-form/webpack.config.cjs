const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const path = require('path');
const BundleOutputPlugin = require('webpack-bundle-output');

const defaultEntries =
	typeof defaultConfig.entry === 'function'
		? defaultConfig.entry()
		: defaultConfig.entry;

module.exports = {
	...defaultConfig,
	entry: () => ({
		...defaultEntries,
		// Admin scripts
		'admin/form-answers/index': path.resolve(
			process.cwd(),
			'src/Admin/form-answers/index.js',
		),
		'admin/questionnaire-responses/index': path.resolve(
			process.cwd(),
			'src/Admin/questionnaire-responses/index.js',
		),
		'admin/submission-detail/index': path.resolve(
			process.cwd(),
			'src/Admin/submission-detail/index.js',
		),
	}),
	plugins: [
		...defaultConfig.plugins,
		new BundleOutputPlugin({
			cwd: process.cwd(),
			output: 'map.json',
		}),
	],
};
