import defaultConfig from '@wordpress/scripts/config/webpack.config.js';
import path from 'path';

const __dirname = import.meta.dirname;

export default {
	...defaultConfig,
	resolve: {
		...defaultConfig.resolve,
		alias: {
			...defaultConfig.resolve.alias,
			'@': path.resolve(__dirname, 'src'),
			'@utils': path.resolve(__dirname, 'src/utils'),
		},
	},
};
