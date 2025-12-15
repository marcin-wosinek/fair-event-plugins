const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const path = require('path');
const BundleOutputPlugin = require('webpack-bundle-output');

module.exports = {
	...defaultConfig,
	entry: {
		'admin/groups/index': path.resolve(
			process.cwd(),
			'src/Admin/groups/index.js'
		),
		'admin/users/index': path.resolve(
			process.cwd(),
			'src/Admin/users/index.js'
		),
		'admin/group-members/index': path.resolve(
			process.cwd(),
			'src/Admin/group-members/index.js'
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
