const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const path = require('path');
const fs = require('fs');

// Build entry points dynamically, only including files that exist
const entries = {};

// Block entries
const blockEntries = {
	'blocks/simple-payment/index': 'src/blocks/simple-payment/index.js',
};

// Admin entries
const adminEntries = {
	'admin/settings/index': 'src/Admin/settings/index.js',
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
};
