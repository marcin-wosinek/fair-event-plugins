<?php
/**
 * Plugin Name: Fair Events E2E Payment Attempts
 * Description: Test-only routes for the get-tickets payment-state API specs,
 *              loaded ONLY inside the Playwright wp-env instance. Seeds a
 *              visitor-owned get-tickets payment attempt (a Mollie-backed
 *              transaction and its signup rows, each in a chosen status),
 *              sets the status the Mollie double reports, and reads back or
 *              removes the attempt.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- test-only fixture routes.

add_action(
	'rest_api_init',
	static function () {
		if ( ! class_exists( '\FairEvents\Models\EventSignup' )
			|| ! class_exists( '\FairPaymentsConnector\Models\Transaction' )
		) {
			return;
		}

		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		$attempt_state = static function ( int $transaction_id ) {
			global $wpdb;

			$transaction = \FairPaymentsConnector\Models\Transaction::get_by_id( $transaction_id );
			$signups     = $wpdb->get_results(
				$wpdb->prepare(
					'SELECT id, status, payment_expires_at FROM %i WHERE transaction_id = %d ORDER BY id ASC',
					$wpdb->prefix . 'fair_events_signups',
					$transaction_id
				)
			);

			return array(
				'transaction_status' => $transaction ? (string) $transaction->status : null,
				'signups'            => array_map(
					static function ( $row ) {
						return array(
							'id'                 => (int) $row->id,
							'status'             => (string) $row->status,
							'payment_expires_at' => $row->payment_expires_at,
							'ticket_statuses'    => array_map(
								static function ( $ticket ) {
									return (string) $ticket->status;
								},
								\FairEvents\Models\EventTicket::get_by_signup_id( (int) $row->id )
							),
						);
					},
					$signups
				),
			);
		};

		// Seed one attempt: POST { event_date_id, transaction_status, signup_statuses[] }.
		register_rest_route(
			'fair-e2e/v1',
			'/payment-attempts',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) use ( $attempt_state ) {
					global $wpdb;

					$event_date_id = absint( $request->get_param( 'event_date_id' ) );
					$statuses      = array_map( 'sanitize_key', (array) $request->get_param( 'signup_statuses' ) );
					if ( ! $event_date_id || ! $statuses ) {
						return new WP_Error( 'invalid_params', 'event_date_id and signup_statuses are required.', array( 'status' => 400 ) );
					}

					$stamp      = gmdate( 'YmdHis' ) . '-' . wp_rand( 1000, 9999 );
					$email      = 'payment.attempt.' . $stamp . '@example.test';
					$signup_ids = array();
					foreach ( $statuses as $index => $status ) {
						$signup_id = \FairEvents\Models\EventSignup::save(
							array(
								'event_date_id' => $event_date_id,
								'name'          => 'Payment Attempt ' . $stamp . ' #' . $index,
								'email'         => $email,
								'quantity'      => 1,
								'amount'        => 10.0,
								'status'        => 'pending_payment',
							)
						);
						if ( ! $signup_id ) {
							return new WP_Error( 'insert_failed', 'Could not insert signup.', array( 'status' => 500 ) );
						}
						$signup_ids[] = (int) $signup_id;
					}

					$transaction_id = \FairPaymentsConnector\Models\Transaction::create(
						array(
							'mollie_payment_id' => 'tr_e2e_attempt_' . $stamp,
							'event_date_id'     => $event_date_id,
							'amount'            => 10.0 * count( $signup_ids ),
							'status'            => sanitize_key( (string) $request->get_param( 'transaction_status' ) ),
							'description'       => 'E2E payment attempt',
							'access_token'      => wp_generate_password( 32, false ),
							'metadata'          => wp_json_encode(
								array(
									'source'        => 'fair-events-get-tickets',
									'event_date_id' => $event_date_id,
									'signup_ids'    => $signup_ids,
								)
							),
						)
					);
					if ( ! $transaction_id ) {
						return new WP_Error( 'insert_failed', 'Could not insert transaction.', array( 'status' => 500 ) );
					}

					// Link each row with a live hold, then put it in the
					// requested status without touching that hold.
					foreach ( $signup_ids as $index => $signup_id ) {
						\FairEvents\Models\EventSignup::update_transaction( $signup_id, (int) $transaction_id );
						$wpdb->update(
							$wpdb->prefix . 'fair_events_signups',
							array( 'status' => $statuses[ $index ] ),
							array( 'id' => $signup_id ),
							array( '%s' ),
							array( '%d' )
						);
						\FairEvents\Models\EventTicket::sync_status_from_signup( $signup_id );
					}

					$transaction = \FairPaymentsConnector\Models\Transaction::get_by_id( (int) $transaction_id );

					return rest_ensure_response(
						array_merge(
							array(
								'transaction_id' => (int) $transaction_id,
								'token'          => (string) $transaction->access_token,
							),
							$attempt_state( (int) $transaction_id )
						)
					);
				},
			)
		);

		// Read or remove one attempt.
		register_rest_route(
			'fair-e2e/v1',
			'/payment-attempts/(?P<transaction_id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'permission_callback' => $admin_only,
					'callback'            => static function ( WP_REST_Request $request ) use ( $attempt_state ) {
						return rest_ensure_response( $attempt_state( absint( $request['transaction_id'] ) ) );
					},
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'permission_callback' => $admin_only,
					'callback'            => static function ( WP_REST_Request $request ) {
						global $wpdb;

						$transaction_id = absint( $request['transaction_id'] );
						$signup_ids     = $wpdb->get_col(
							$wpdb->prepare(
								'SELECT id FROM %i WHERE transaction_id = %d',
								$wpdb->prefix . 'fair_events_signups',
								$transaction_id
							)
						);
						foreach ( $signup_ids as $signup_id ) {
							\FairEvents\Models\EventSignup::delete( (int) $signup_id );
						}
						$wpdb->delete(
							\FairPaymentsConnector\Database\Schema::get_payments_table_name(),
							array( 'id' => $transaction_id ),
							array( '%d' )
						);

						return rest_ensure_response( array( 'deleted' => true ) );
					},
				),
			)
		);

		// The status the Mollie double reports on GET /v2/payments/{id}
		// (see lib/mollie-http-double.php and scripts/set-mollie-status.php).
		register_rest_route(
			'fair-e2e/v1',
			'/mollie-status',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => $admin_only,
				'args'                => array(
					'status' => array(
						'type'     => 'string',
						'required' => true,
						'enum'     => array( 'paid', 'open', 'pending', 'failed', 'canceled', 'expired' ),
					),
				),
				'callback'            => static function ( WP_REST_Request $request ) {
					update_option( 'fair_e2e_mollie_get_status', $request->get_param( 'status' ) );
					return rest_ensure_response( array( 'status' => $request->get_param( 'status' ) ) );
				},
			)
		);
	}
);
