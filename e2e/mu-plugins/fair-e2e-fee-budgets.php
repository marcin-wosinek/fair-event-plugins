<?php
/**
 * Plugin Name: Fair Audience E2E Fee Budgets
 * Description: Test-only route for the membership fee budget specs, loaded
 *              ONLY inside the Playwright wp-env instance. Hides the Fair
 *              Finance budgets table by renaming it, and puts it back, so a
 *              spec can read fees the way a site without Fair Finance does.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'rest_api_init',
	static function () {
		// `present: false` hides the budgets table, `present: true` restores
		// it. Either call is safe to repeat, so a spec can restore the table
		// before and after its run whatever an earlier run left behind.
		register_rest_route(
			'fair-e2e/v1',
			'/fee-budgets/finance-table',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$table  = $wpdb->prefix . 'fair_payment_budgets';
					$hidden = $table . '_e2e_hidden';
					$exists = static function ( $name ) use ( $wpdb ) {
						// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- test-only fixture read.
						return $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $name ) ) ) === $name;
					};

					$present = rest_sanitize_boolean( $request->get_param( 'present' ) );
					$from    = $present ? $hidden : $table;
					$to      = $present ? $table : $hidden;

					if ( $exists( $from ) && ! $exists( $to ) ) {
						// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange -- test-only fixture, restored by the spec.
						$wpdb->query( $wpdb->prepare( 'RENAME TABLE %i TO %i', $from, $to ) );
					}

					return rest_ensure_response( array( 'present' => $exists( $table ) ) );
				},
			)
		);
	}
);
