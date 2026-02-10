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
		'admin/polls-list/index': path.resolve(
			process.cwd(),
			'src/Admin/polls-list/index.js',
		),
		'admin/edit-poll/index': path.resolve(
			process.cwd(),
			'src/Admin/edit-poll/index.js',
		),
		'admin/collaborators/index': path.resolve(
			process.cwd(),
			'src/Admin/collaborators/index.js',
		),
		'admin/groups/index': path.resolve(
			process.cwd(),
			'src/Admin/groups/index.js',
		),
		'admin/settings/index': path.resolve(
			process.cwd(),
			'src/Admin/settings/index.js',
		),
		'admin/instagram-posts/index': path.resolve(
			process.cwd(),
			'src/Admin/instagram-posts/index.js',
		),
		'admin/image-templates/index': path.resolve(
			process.cwd(),
			'src/Admin/image-templates/index.js',
		),
		'admin/weekly-schedule/index': path.resolve(
			process.cwd(),
			'src/Admin/weekly-schedule/index.js',
		),
		'admin/media-library-filter': path.resolve(
			process.cwd(),
			'src/Admin/media-library-filter.js',
		),
		// Public scripts
		'public/poll-response/index': path.resolve(
			process.cwd(),
			'src/public/poll-response/index.js',
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
