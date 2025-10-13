const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const path = require('path');

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
	},
};
