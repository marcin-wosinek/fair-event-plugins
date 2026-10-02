<?php
/**
 * Plugin Name: Fair Events E2E Checkout Keys
 * Description: Test-only routes for the get-tickets idempotency API specs,
 *              loaded ONLY inside the Playwright wp-env instance. Reads the
 *              checkout keys, signups and transactions of an event date,
 *              interrupts a checkout the way a crash or a provider outage
 *              would, lets a claim run out without waiting for it, ages
 *              keys for the cleanup, and reads a buyer's captured mail.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- test-only fixture routes.

// Crash the request while its transaction is being created, leaving the
// checkout exactly as a dead PHP process would: signups saved, nothing else.
add_filter(
	'fair_payment_before_create_transaction',
	static function ( $transaction_data ) {
		$crashes = (int) get_option( 'fair_e2e_crash_transaction_creates', 0 );
		if ( $crashes > 0 ) {
			update_option( 'fair_e2e_crash_transaction_creates', $crashes - 1, false );
			throw new RuntimeException( 'E2E: simulated crash while creating the transaction.' );
		}

		return $transaction_data;
	}
);

add_action(
	'rest_api_init',
	static function () {
		if ( ! class_exists( '\FairEvents\Models\CheckoutKey' ) ) {
			return;
		}

		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		// Signup rows of an event date (or of several, for a series).
		$signups_of = static function ( array $event_date_ids ) {
			global $wpdb;

			$event_date_ids = array_values( array_filter( array_map( 'absint', $event_date_ids ) ) );
			if ( ! $event_date_ids ) {
				return array();
			}

			return $wpdb->get_results(
				$wpdb->prepare(
					'SELECT * FROM %i WHERE event_date_id IN (' . implode( ', ', array_fill( 0, count( $event_date_ids ), '%d' ) ) . ') ORDER BY id ASC',
					array_merge( array( $wpdb->prefix . 'fair_events_signups' ), $event_date_ids )
				)
			);
		};

		// Checkout keys whose purchase includes one of the given signups.
		$keys_of = static function ( array $signup_ids ) {
			global $wpdb;

			$keys = array();
			foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM %i ORDER BY id ASC', \FairEvents\Models\CheckoutKey::table() ) ) as $record ) {
				if ( array_intersect( \FairEvents\Models\CheckoutKey::signup_ids( $record ), $signup_ids ) ) {
					$keys[] = $record;
				}
			}

			return $keys;
		};

		// Everything a checkout leaves behind on the given event dates.
		register_rest_route(
			'fair-e2e/v1',
			'/checkout-keys',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) use ( $signups_of, $keys_of ) {
					global $wpdb;

					$signups         = $signups_of( (array) $request->get_param( 'event_date_ids' ) );
					$signup_ids      = array_map( static fn( $signup ) => (int) $signup->id, $signups );
					$transaction_ids = array_values( array_unique( array_filter( array_map( static fn( $signup ) => (int) $signup->transaction_id, $signups ) ) ) );

					$transactions = array();
					foreach ( $transaction_ids as $transaction_id ) {
						$transaction    = \FairPaymentsConnector\Models\Transaction::get_by_id( $transaction_id );
						$transactions[] = array(
							'id'                => $transaction_id,
							'status'            => (string) $transaction->status,
							'amount'            => (float) $transaction->amount,
							'mollie_payment_id' => (string) $transaction->mollie_payment_id,
							'participant_id'    => $transaction->participant_id ? (int) $transaction->participant_id : null,
							'event_date_id'     => $transaction->event_date_id ? (int) $transaction->event_date_id : null,
						);
					}

					return rest_ensure_response(
						array(
							'signups'             => array_map(
								static function ( $signup ) {
									$tickets = \FairEvents\Models\EventTicket::get_by_signup_id( (int) $signup->id );
									return array(
										'id'              => (int) $signup->id,
										'event_date_id'   => (int) $signup->event_date_id,
										'email'           => (string) $signup->email,
										'status'          => (string) $signup->status,
										'quantity'        => (int) $signup->quantity,
										'ticket_type_id'  => $signup->ticket_type_id ? (int) $signup->ticket_type_id : null,
										'transaction_id'  => $signup->transaction_id ? (int) $signup->transaction_id : null,
										'participant_id'  => $signup->participant_id ? (int) $signup->participant_id : null,
										'over_capacity'   => (bool) $signup->over_capacity,
										'ticket_statuses' => array_map( static fn( $ticket ) => (string) $ticket->status, $tickets ),
									);
								},
								$signups
							),
							'transactions'        => $transactions,
							'keys'                => array_map(
								static function ( $record ) {
									return array(
										'id'          => (int) $record->id,
										'state'       => (string) $record->state,
										'signup_ids'  => \FairEvents\Models\CheckoutKey::signup_ids( $record ),
										'hooks_fired' => (bool) $record->hooks_fired,
										'claimed'     => null !== $record->claim_expires_at,
									);
								},
								$keys_of( $signup_ids )
							),
							'mollie_create_count' => (int) get_option( 'fair_e2e_mollie_create_count', 0 ),
							'key_count'           => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i', \FairEvents\Models\CheckoutKey::table() ) ),
						)
					);
				},
			)
		);

		// Mail captured for one recipient (see fair-e2e-support.php).
		register_rest_route(
			'fair-e2e/v1',
			'/checkout-keys/mail',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					$email = strtolower( sanitize_email( (string) $request->get_param( 'email' ) ) );
					$mail  = array();
					foreach ( (array) get_option( 'fair_e2e_captured_mail', array() ) as $entry ) {
						$recipients = array_map( 'strtolower', (array) ( $entry['to'] ?? array() ) );
						if ( in_array( $email, $recipients, true ) ) {
							$mail[] = array(
								'subject' => (string) ( $entry['subject'] ?? '' ),
								'body'    => (string) ( $entry['body'] ?? '' ),
							);
						}
					}

					return rest_ensure_response( $mail );
				},
			)
		);

		// Arm failures: { crash_transaction_creates, fail_mollie_creates }.
		register_rest_route(
			'fair-e2e/v1',
			'/checkout-keys/faults',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					update_option( 'fair_e2e_crash_transaction_creates', absint( $request->get_param( 'crash_transaction_creates' ) ), false );
					update_option( 'fair_e2e_mollie_fail_creates', absint( $request->get_param( 'fail_mollie_creates' ) ), false );

					return rest_ensure_response( array( 'armed' => true ) );
				},
			)
		);

		// Let the claims on an event date's checkouts run out, as time would
		// after the request holding them died.
		register_rest_route(
			'fair-e2e/v1',
			'/checkout-keys/expire-claims',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) use ( $signups_of, $keys_of ) {
					global $wpdb;

					$signup_ids = array_map( static fn( $signup ) => (int) $signup->id, $signups_of( (array) $request->get_param( 'event_date_ids' ) ) );
					$expired    = 0;
					foreach ( $keys_of( $signup_ids ) as $record ) {
						$expired += (int) $wpdb->query(
							$wpdb->prepare(
								'UPDATE %i SET claim_expires_at = %s WHERE id = %d AND claim_expires_at IS NOT NULL',
								\FairEvents\Models\CheckoutKey::table(),
								gmdate( 'Y-m-d H:i:s', time() - MINUTE_IN_SECONDS ),
								(int) $record->id
							)
						);
					}

					return rest_ensure_response( array( 'expired' => $expired ) );
				},
			)
		);

		// Age an event date's checkout keys past their retention and run the
		// hourly cleanup.
		register_rest_route(
			'fair-e2e/v1',
			'/checkout-keys/cleanup',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) use ( $signups_of, $keys_of ) {
					global $wpdb;

					$signup_ids = array_map( static fn( $signup ) => (int) $signup->id, $signups_of( (array) $request->get_param( 'event_date_ids' ) ) );
					foreach ( $keys_of( $signup_ids ) as $record ) {
						$wpdb->update(
							\FairEvents\Models\CheckoutKey::table(),
							array( 'created_at' => gmdate( 'Y-m-d H:i:s', time() - \FairEvents\Models\CheckoutKey::RETENTION_SECONDS - DAY_IN_SECONDS ) ),
							array( 'id' => (int) $record->id ),
							array( '%s' ),
							array( '%d' )
						);
					}

					\FairEvents\Hooks\PaymentHooks::cleanup_expired_signups();

					return rest_ensure_response( array( 'remaining' => count( $keys_of( $signup_ids ) ) ) );
				},
			)
		);
	}
);
