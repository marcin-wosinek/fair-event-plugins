import defaultConfig from '@wordpress/scripts/config/webpack.config.js';
import path from 'path';

export default {
	...defaultConfig,
	entry: {
		// Block entries
		'blocks/time-block/index': path.resolve(
			process.cwd(),
			'src/blocks/time-block',
			'index.js'
		),
		'blocks/time-block/style': path.resolve(
			process.cwd(),
			'src/blocks/time-block',
			'style.css'
		),
		'blocks/schedule-column/index': path.resolve(
			process.cwd(),
			'src/blocks/schedule-column',
			'index.js'
		),
		'blocks/schedule-column/style': path.resolve(
			process.cwd(),
			'src/blocks/schedule-column',
			'style.css'
		),
	},
	output: {
		...defaultConfig.output,
		path: path.resolve(process.cwd(), 'build'),
	},
};
