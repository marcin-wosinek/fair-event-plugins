/**
 * Builds the admin table review example (#2205) into the e2e mu-plugin, so
 * only the wp-env tests site serves it. Nothing here ships in a plugin.
 */
const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const path = require( 'path' );

module.exports = {
	...defaultConfig,
	entry: {
		index: path.resolve( __dirname, 'src/admin-table/example/index.js' ),
	},
	output: {
		...defaultConfig.output,
		path: path.resolve(
			__dirname,
			'../e2e/mu-plugins/admin-table-example/build'
		),
	},
};
