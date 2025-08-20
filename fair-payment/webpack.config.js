import defaultConfig from '@wordpress/scripts/config/webpack.config.js';
import path from 'path';

export default {
	...defaultConfig,
	entry: {
		// Block entries
		'blocks/simple-payment/index': path.resolve(
			process.cwd(),
			'src/blocks/simple-payment',
			'index.js'
		),

		// Admin entries
		'admin/admin': path.resolve(process.cwd(), 'src/admin/js', 'admin.js'),
	},
	output: {
		...defaultConfig.output,
		path: path.resolve(process.cwd(), 'build'),
	},
};
