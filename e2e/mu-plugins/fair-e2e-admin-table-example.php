<?php
/**
 * Plugin Name: Fair Events E2E Admin Table Example
 * Description: Test-only review page for the shared admin table pattern
 *              (#2205), loaded ONLY inside the Playwright wp-env instance.
 *              Serves the example that `npm run build` in fair-events-shared
 *              writes to admin-table-example/build/. Synthetic data only.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

const FAIR_E2E_ADMIN_TABLE_EXAMPLE_SLUG = 'fair-e2e-admin-table-example';

add_action(
	'admin_menu',
	static function () {
		// Hidden page: '' (not null) as the parent slug.
		add_submenu_page(
			'',
			'Admin table example',
			'Admin table example',
			'manage_options',
			FAIR_E2E_ADMIN_TABLE_EXAMPLE_SLUG,
			static function () {
				if ( ! file_exists( __DIR__ . '/admin-table-example/build/index.asset.php' ) ) {
					echo '<div class="wrap"><p>Run <code>npm run build</code> in fair-events-shared to build the admin table example.</p></div>';
					return;
				}
				echo '<div id="fair-admin-table-example-root"></div>';
			}
		);
	}
);

add_action(
	'admin_enqueue_scripts',
	static function ( $hook ) {
		if ( 'admin_page_' . FAIR_E2E_ADMIN_TABLE_EXAMPLE_SLUG !== $hook ) {
			return;
		}

		$asset_file = __DIR__ . '/admin-table-example/build/index.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return;
		}

		$asset    = include $asset_file;
		$base_url = plugins_url( 'admin-table-example/build/', __FILE__ );

		wp_enqueue_script(
			FAIR_E2E_ADMIN_TABLE_EXAMPLE_SLUG,
			$base_url . 'index.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);
		wp_enqueue_style( 'wp-components' );
		foreach ( array( 'style-index.css', 'index.css' ) as $stylesheet ) {
			if ( file_exists( __DIR__ . '/admin-table-example/build/' . $stylesheet ) ) {
				wp_enqueue_style(
					FAIR_E2E_ADMIN_TABLE_EXAMPLE_SLUG . '-' . sanitize_key( $stylesheet ),
					$base_url . $stylesheet,
					array( 'wp-components' ),
					$asset['version']
				);
			}
		}
	}
);
