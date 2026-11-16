<?php
/**
 * Plugin Name: Fair Finance E2E Legacy Imports
 * Description: Test-only route for the bank-origin specs, loaded ONLY inside
 *              the Playwright wp-env instance. Writes a payment source and
 *              payer straight onto a financial entry, reproducing a bank
 *              import classified before bank imports were protected — a
 *              state the REST API can no longer create.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'rest_api_init',
	static function () {
		register_rest_route(
			'fair-e2e/v1',
			'/finance/legacy-classification',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
				'args'                => array(
					'entry_id'       => array(
						'type'     => 'integer',
						'required' => true,
					),
					'payment_source' => array(
						'type'     => 'string',
						'enum'     => array( 'event_cash', 'personal_funds' ),
						'required' => true,
					),
					'payer_name'     => array(
						'type'    => array( 'string', 'null' ),
						'default' => null,
					),
					'event_date_id'  => array(
						'type'    => array( 'integer', 'null' ),
						'default' => null,
					),
				),
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- test-only fixture write.
					$updated = $wpdb->update(
						$wpdb->prefix . 'fair_payment_financial_entries',
						array(
							'payment_source' => $request->get_param( 'payment_source' ),
							'payer_name'     => $request->get_param( 'payer_name' ),
							'event_date_id'  => $request->get_param( 'event_date_id' ),
						),
						array( 'id' => (int) $request->get_param( 'entry_id' ) ),
						array( '%s', '%s', '%d' ),
						array( '%d' )
					);

					return rest_ensure_response( array( 'updated' => (int) $updated ) );
				},
			)
		);
	}
);
