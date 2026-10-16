<?php
/**
 * Plugin Name: Fair E2E Saved Settlements
 * Description: Test-only routes that reset saved settlements, set the Mollie
 *              organization and granted permissions, and steer the settlement
 *              responses of the Mollie double (see lib/mollie-http-double.php).
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/lib/settlement-reconciliation-fixtures.php';

add_action(
	'rest_api_init',
	static function () {
		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		/*
		 * POST fair-e2e/v1/settlements/reset
		 *
		 * Empties every saved-settlement table, removes the operation log rows
		 * of settlement imports and resets the double. With
		 * `restore`, also forgets the organization and permissions it set.
		 */
		register_rest_route(
			'fair-e2e/v1',
			'/settlements/reset',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					foreach ( array( 'settlement_import_runs', 'settlement_items', 'settlement_revisions', 'settlements', 'settlement_accounts' ) as $table ) {
						// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- test-only cleanup.
						$wpdb->query( $wpdb->prepare( 'TRUNCATE TABLE %i', $wpdb->prefix . 'fair_payment_' . $table ) );
					}

					// Import run IDs start over, so their operation log rows go too.
					// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- test-only cleanup.
					$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE settlement_run_id IS NOT NULL', $wpdb->prefix . 'fair_payment_external_update_runs' ) );

					delete_option( 'fair_e2e_settlements' );
					delete_option( 'fair_e2e_reconciliation_fail' );
					delete_option( 'fair_e2e_mollie_disconnected' );

					if ( $request->get_param( 'restore' ) ) {
						delete_option( 'fair_payment_organization_id' );
						delete_option( 'fair_payment_mollie_scopes' );
					} else {
						update_option( 'fair_payment_organization_id', 'org_e2e0001' );
						update_option( 'fair_payment_mollie_scopes', array( 'payments.read', 'settlements.read' ) );
					}

					return rest_ensure_response( array( 'reset' => true ) );
				},
			)
		);

		/*
		 * GET  fair-e2e/v1/settlements/state  -> the double's request count.
		 * POST fair-e2e/v1/settlements/state  -> { fail_match, variant,
		 *      organization_id, scopes, age_running, forget_reports }.
		 */
		register_rest_route(
			'fair-e2e/v1',
			'/settlements/state',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'permission_callback' => $admin_only,
					'callback'            => static function () {
						$state = (array) get_option( 'fair_e2e_settlements', array() );
						return rest_ensure_response( array( 'requests' => (int) ( $state['requests'] ?? 0 ) ) );
					},
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'permission_callback' => $admin_only,
					'callback'            => static function ( WP_REST_Request $request ) {
						global $wpdb;

						$state = (array) get_option( 'fair_e2e_settlements', array() );
						foreach ( array( 'fail_match', 'variant' ) as $key ) {
							if ( $request->has_param( $key ) ) {
								$state[ $key ] = sanitize_text_field( (string) $request->get_param( $key ) );
							}
						}
						update_option( 'fair_e2e_settlements', $state, false );

						if ( $request->has_param( 'organization_id' ) ) {
							update_option( 'fair_payment_organization_id', sanitize_text_field( (string) $request->get_param( 'organization_id' ) ) );
						}

						if ( $request->has_param( 'scopes' ) ) {
							$scopes = array_values( array_filter( array_map( 'sanitize_text_field', (array) $request->get_param( 'scopes' ) ) ) );
							if ( empty( $scopes ) ) {
								delete_option( 'fair_payment_mollie_scopes' );
							} else {
								update_option( 'fair_payment_mollie_scopes', $scopes );
							}
						}

						// Make running imports look abandoned, as after a dead request.
						if ( $request->get_param( 'age_running' ) ) {
							// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- test-only fixture.
							$wpdb->query(
								$wpdb->prepare(
									'UPDATE %i SET updated_at = %s WHERE status = %s',
									$wpdb->prefix . 'fair_payment_settlement_import_runs',
									gmdate( 'Y-m-d H:i:s', time() - HOUR_IN_SECONDS ),
									'running'
								)
							);
						}

						// Make saved revisions look as they did before report details were kept.
						if ( $request->get_param( 'forget_reports' ) ) {
							// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- test-only fixture.
							$wpdb->query( $wpdb->prepare( 'UPDATE %i SET report_version = NULL', $wpdb->prefix . 'fair_payment_settlement_revisions' ) );
							// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- test-only fixture.
							$wpdb->query( $wpdb->prepare( 'UPDATE %i SET report = NULL', $wpdb->prefix . 'fair_payment_settlement_items' ) );
						}

						return rest_ensure_response( array( 'updated' => true ) );
					},
				),
			)
		);
	}
);
