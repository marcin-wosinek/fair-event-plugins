const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const path = require('path');

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
		};
	},
};

module.exports = customConfig;
