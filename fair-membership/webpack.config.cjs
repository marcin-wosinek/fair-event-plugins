const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const path = require('path');
const BundleOutputPlugin = require('webpack-bundle-output');

module.exports = {
	...defaultConfig,
	entry: {
		'admin/users/index': path.resolve(
			process.cwd(),
			'src/Admin/users/index.js'
		),
		'admin/import-users/index': path.resolve(
			process.cwd(),
			'src/Admin/import-users/index.js'
		),
		'blocks/membership-switch/editor': path.resolve(
			process.cwd(),
			'src/blocks/membership-switch/editor.js'
		),
		'blocks/member-content/editor': path.resolve(
			process.cwd(),
			'src/blocks/member-content/editor.js'
		),
		'blocks/non-member-content/editor': path.resolve(
			process.cwd(),
			'src/blocks/non-member-content/editor.js'
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
