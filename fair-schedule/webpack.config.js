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
	},
	output: {
		...defaultConfig.output,
		path: path.resolve(process.cwd(), 'build'),
	},
};
