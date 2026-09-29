<?php
/**
 * Plugin Name: Fair Events E2E Transaction Participants
 * Description: Test-only routes for the transaction-participant link API
 *              specs, loaded ONLY inside the Playwright wp-env instance.
 *              Reads a transaction's participant link and ledger rows,
 *              reproduces the history and conflicts production data can
 *              hold, replays the post-signup transaction hook, runs the
 *              repair, and simulates Fair Audience being inactive.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- test-only fixture routes.

/*
 * A request carrying this header runs as if Fair Audience were inactive:
 * every Fair Audience callback on a Fair Events or payments hook is removed
 * before the request is dispatched.
 */
add_action(
	'rest_api_init',
	static function () {
		if ( empty( $_SERVER['HTTP_X_FAIR_E2E_WITHOUT_AUDIENCE'] ) ) {
			return;
		}

		global $wp_filter;
		foreach ( $wp_filter as $hook_name => $hook ) {
			if ( ! str_starts_with( $hook_name, 'fair_events_' ) && ! str_starts_with( $hook_name, 'fair_payment_' ) ) {
				continue;
			}
			foreach ( $hook->callbacks as $priority => $callbacks ) {
				foreach ( $callbacks as $callback ) {
					$function = $callback['function'];
					$class    = is_array( $function ) ? ( is_object( $function[0] ) ? get_class( $function[0] ) : (string) $function[0] ) : '';
					if ( str_starts_with( ltrim( $class, '\\' ), 'FairAudience\\' ) ) {
						remove_filter( $hook_name, $function, $priority );
					}
				}
			}
		}
	},
	1
);

add_action(
	'rest_api_init',
	static function () {
		if ( ! class_exists( '\FairAudience\Services\TransactionParticipantRepair' ) ) {
			return;
		}

		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		$transactions_table = static function () {
			return \FairPaymentsConnector\Database\Schema::get_payments_table_name();
		};

		// A transaction's participant link, and the participants of the
		// registrations its ledger rows point at.
		register_rest_route(
			'fair-e2e/v1',
			'/transaction-participants/state',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) use ( $transactions_table ) {
					global $wpdb;

					$transaction_id = absint( $request->get_param( 'transaction_id' ) );
					$participant_id = $wpdb->get_var(
						$wpdb->prepare( 'SELECT participant_id FROM %i WHERE id = %d', $transactions_table(), $transaction_id )
					);
					$ledger         = $wpdb->get_results(
						$wpdb->prepare(
							'SELECT l.event_participant_id, ep.participant_id, ep.event_date_id FROM %i l
							 INNER JOIN %i ep ON ep.id = l.event_participant_id
							 WHERE l.transaction_id = %d AND l.kind = %s
							 ORDER BY l.event_participant_id',
							$wpdb->prefix . 'fair_audience_event_participant_transactions',
							$wpdb->prefix . 'fair_audience_event_participants',
							$transaction_id,
							'charge'
						),
						ARRAY_A
					);

					$signups = array();
					foreach ( (array) $request->get_param( 'signup_ids' ) as $signup_id ) {
						$signup = \FairEvents\Models\EventSignup::get_by_id( absint( $signup_id ) );
						if ( $signup ) {
							$signups[] = array(
								'id'             => (int) $signup->id,
								'participant_id' => $signup->participant_id ? (int) $signup->participant_id : null,
								'transaction_id' => $signup->transaction_id ? (int) $signup->transaction_id : null,
								'event_date_id'  => (int) $signup->event_date_id,
							);
						}
					}

					return rest_ensure_response(
						array(
							'participant_id' => null === $participant_id ? null : (int) $participant_id,
							'ledger'         => array_map(
								static function ( $row ) {
									return array_map( 'intval', $row );
								},
								$ledger
							),
							'signups'        => $signups,
						)
					);
				},
			)
		);

		// Put a transaction back into a state production history can hold:
		// a given (or no) participant link, optionally without ledger rows,
		// and optionally a failed payment status.
		register_rest_route(
			'fair-e2e/v1',
			'/transaction-participants/transaction',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) use ( $transactions_table ) {
					global $wpdb;

					$transaction_id = absint( $request->get_param( 'transaction_id' ) );

					if ( $request->has_param( 'participant_id' ) ) {
						$participant_id = absint( $request->get_param( 'participant_id' ) );
						$wpdb->query(
							$wpdb->prepare(
								'UPDATE %i SET participant_id = NULLIF(%d, 0) WHERE id = %d',
								$transactions_table(),
								$participant_id,
								$transaction_id
							)
						);
					}

					if ( $request->get_param( 'clear_ledger' ) ) {
						$wpdb->delete(
							$wpdb->prefix . 'fair_audience_event_participant_transactions',
							array( 'transaction_id' => $transaction_id ),
							array( '%d' )
						);
					}

					if ( $request->get_param( 'status' ) ) {
						$wpdb->update(
							$transactions_table(),
							array( 'status' => sanitize_key( $request->get_param( 'status' ) ) ),
							array( 'id' => $transaction_id ),
							array( '%s' ),
							array( '%d' )
						);
					}

					return rest_ensure_response( array( 'transaction_id' => $transaction_id ) );
				},
			)
		);

		// Point a signup at another participant, as ambiguous history can.
		register_rest_route(
			'fair-e2e/v1',
			'/transaction-participants/signup',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$participant_id = absint( $request->get_param( 'participant_id' ) );
					$wpdb->update(
						$wpdb->prefix . 'fair_events_signups',
						array( 'participant_id' => $participant_id ? $participant_id : null ),
						array( 'id' => absint( $request->get_param( 'signup_id' ) ) ),
						array( '%d' ),
						array( '%d' )
					);

					return rest_ensure_response( array( 'updated' => true ) );
				},
			)
		);

		// Replay the post-signup transaction hook, as a repeated callback
		// would.
		register_rest_route(
			'fair-e2e/v1',
			'/transaction-participants/replay',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					do_action(
						'fair_events_signup_transaction_created',
						absint( $request->get_param( 'transaction_id' ) ),
						array_map( 'absint', (array) $request->get_param( 'signup_ids' ) )
					);

					return rest_ensure_response( array( 'replayed' => true ) );
				},
			)
		);

		// Run the repair from a fresh start, as the upgrade does.
		register_rest_route(
			'fair-e2e/v1',
			'/transaction-participants/repair',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function () {
					delete_option( \FairAudience\Services\TransactionParticipantRepair::STATE_OPTION );

					return rest_ensure_response( \FairAudience\Services\TransactionParticipantRepair::run_batch( 100000 ) );
				},
			)
		);
	}
);
