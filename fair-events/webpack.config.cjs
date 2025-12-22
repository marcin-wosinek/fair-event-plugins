const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const path = require('path');
const fs = require('fs');
const BundleOutputPlugin = require('webpack-bundle-output');

// Build entry points dynamically, only including files that exist
const entries = {};

// Blocks
const blockEntries = {
	'blocks/event-dates/editor': 'src/blocks/event-dates/editor.js',
	'blocks/events-list/editor': 'src/blocks/events-list/editor.js',
	'blocks/events-calendar/editor': 'src/blocks/events-calendar/editor.js',
};

// Admin pages
const adminEntries = {
	'admin/settings/index': 'src/Admin/settings/index.js',
	'admin/event-meta/index': 'src/Admin/event-meta/index.js',
};

// Combine all potential entries
const allEntries = { ...blockEntries, ...adminEntries };

// Only add entries for files that exist
Object.entries(allEntries).forEach(([key, filePath]) => {
	const fullPath = path.resolve(process.cwd(), filePath);
	if (fs.existsSync(fullPath)) {
		entries[key] = fullPath;
	}
});

module.exports = {
	...defaultConfig,
	entry: entries,
	plugins: [
		...defaultConfig.plugins,
		new BundleOutputPlugin({
			cwd: process.cwd(),
			output: 'map.json',
		}),
	],
};
