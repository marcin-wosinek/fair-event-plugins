<?php
/**
 * Plugin Name: Fair Events E2E Ticket Capacity
 * Description: Test-only routes for fair-events ticket capacity API specs,
 *              loaded ONLY inside the Playwright wp-env instance. Reads the
 *              capacity counts, drives payment confirmation and hold lapses
 *              that production reaches through webhooks and time, changes a
 *              single unit's status, and seeds admissions from before ticket
 *              units.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- test-only fixture routes.

add_action(
	'rest_api_init',
	static function () {
		if ( ! class_exists( '\FairEvents\Services\TicketCapacity' ) ) {
			return;
		}

		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		$signup_state = static function ( $signup_id ) {
			return array(
				'signup'  => \FairEvents\Models\EventSignup::get_by_id( $signup_id ),
				'tickets' => \FairEvents\Models\EventTicket::get_by_signup_id( $signup_id ),
			);
		};

		// Places taken on an event date, a ticket type and/or an activity
		// on an occurrence.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-capacity',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					$capacity = \FairEvents\Services\TicketCapacity::class;
					$counts   = array();

					foreach ( (array) $request->get_param( 'event_date_ids' ) as $event_date_id ) {
						$counts['event_dates'][ absint( $event_date_id ) ] = $capacity::count_event_date( absint( $event_date_id ) );
					}
					foreach ( (array) $request->get_param( 'ticket_type_ids' ) as $ticket_type_id ) {
						$counts['ticket_types'][ absint( $ticket_type_id ) ] = $capacity::count_ticket_type( absint( $ticket_type_id ) );
					}
					// Activity places, each given as "optionId:eventDateId".
					foreach ( (array) $request->get_param( 'options' ) as $pair ) {
						list( $option_id, $event_date_id ) = array_map( 'absint', explode( ':', (string) $pair ) + array( 0, 0 ) );
						$counts['ticket_options'][ $option_id . ':' . $event_date_id ] = $capacity::count_ticket_option( $option_id, $event_date_id );
					}

					return rest_ensure_response( $counts );
				},
			)
		);

		// A signup row and its ticket units.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-capacity/signup',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) use ( $signup_state ) {
					return rest_ensure_response( $signup_state( absint( $request->get_param( 'signup_id' ) ) ) );
				},
			)
		);

		// Run the paid webhook's handling for a signup's transaction.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-capacity/pay',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) use ( $signup_state ) {
					$signup_id   = absint( $request->get_param( 'signup_id' ) );
					$signup      = \FairEvents\Models\EventSignup::get_by_id( $signup_id );
					$transaction = $signup && $signup->transaction_id
						? \FairPaymentsConnector\Models\Transaction::get_by_id( (int) $signup->transaction_id )
						: null;

					if ( ! $transaction ) {
						return new WP_Error( 'no_transaction', 'Signup has no transaction.', array( 'status' => 400 ) );
					}

					\FairEvents\Hooks\PaymentHooks::handle_payment_paid( (object) array(), $transaction );

					return rest_ensure_response( $signup_state( $signup_id ) );
				},
			)
		);

		// Fail a signup's transaction as the payment provider would.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-capacity/fail',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) use ( $signup_state ) {
					global $wpdb;

					$signup_id = absint( $request->get_param( 'signup_id' ) );
					$signup    = \FairEvents\Models\EventSignup::get_by_id( $signup_id );
					if ( ! $signup || ! $signup->transaction_id ) {
						return new WP_Error( 'no_transaction', 'Signup has no transaction.', array( 'status' => 400 ) );
					}

					$wpdb->update(
						\FairPaymentsConnector\Database\Schema::get_payments_table_name(),
						array( 'status' => 'failed' ),
						array( 'id' => (int) $signup->transaction_id ),
						array( '%s' ),
						array( '%d' )
					);
					\FairEvents\Hooks\PaymentHooks::handle_payment_failed(
						(object) array(),
						\FairPaymentsConnector\Models\Transaction::get_by_id( (int) $signup->transaction_id )
					);

					return rest_ensure_response( $signup_state( $signup_id ) );
				},
			)
		);

		// Let a signup's payment hold run out without the expiry cron
		// having processed it yet.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-capacity/lapse',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) use ( $signup_state ) {
					global $wpdb;

					$signup_id = absint( $request->get_param( 'signup_id' ) );
					$wpdb->update(
						$wpdb->prefix . 'fair_events_signups',
						array( 'payment_expires_at' => gmdate( 'Y-m-d H:i:s', time() - MINUTE_IN_SECONDS ) ),
						array( 'id' => $signup_id ),
						array( '%s' ),
						array( '%d' )
					);

					return rest_ensure_response( $signup_state( $signup_id ) );
				},
			)
		);

		// Set one ticket unit's own status (e.g. cancel one of several).
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-capacity/unit-status',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) use ( $signup_state ) {
					global $wpdb;

					$signup_id = absint( $request->get_param( 'signup_id' ) );
					$wpdb->update(
						$wpdb->prefix . 'fair_events_tickets',
						array( 'status' => sanitize_key( (string) $request->get_param( 'status' ) ) ),
						array(
							'signup_id'     => $signup_id,
							'unit_position' => absint( $request->get_param( 'position' ) ),
						),
						array( '%s' ),
						array( '%d', '%d' )
					);

					return rest_ensure_response( $signup_state( $signup_id ) );
				},
			)
		);

		// Insert a signup without units, as before the ticket-unit backfill.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-capacity/unbackfilled-signup',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$ticket_type_id = absint( $request->get_param( 'ticket_type_id' ) );
					$participant_id = absint( $request->get_param( 'participant_id' ) );
					$wpdb->insert(
						$wpdb->prefix . 'fair_events_signups',
						array(
							'event_date_id'  => absint( $request->get_param( 'event_date_id' ) ),
							'ticket_type_id' => $ticket_type_id ? $ticket_type_id : null,
							'name'           => 'Unbackfilled Buyer',
							'email'          => sanitize_email( (string) $request->get_param( 'email' ) ),
							'quantity'       => max( 1, absint( $request->get_param( 'quantity' ) ) ),
							'status'         => 'confirmed',
							'participant_id' => $participant_id ? $participant_id : null,
							'created_at'     => current_time( 'mysql' ),
						),
						array( '%d', '%d', '%s', '%s', '%d', '%s', '%d', '%s' )
					);

					return rest_ensure_response( array( 'signup_id' => (int) $wpdb->insert_id ) );
				},
			)
		);

		// Insert a fair-audience admission with no signup behind it, as the
		// retired purchase route or an organizer adding someone by hand does.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-capacity/legacy-admission',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$email = sanitize_email( (string) $request->get_param( 'email' ) );
					$wpdb->insert(
						$wpdb->prefix . 'fair_audience_participants',
						array(
							'name'    => 'Legacy',
							'surname' => 'Admission',
							'email'   => $email,
						),
						array( '%s', '%s', '%s' )
					);
					$participant_id = (int) $wpdb->insert_id;

					$event_date     = \FairEvents\Models\EventDates::get_by_id( absint( $request->get_param( 'event_date_id' ) ) );
					$ticket_type_id = absint( $request->get_param( 'ticket_type_id' ) );
					$wpdb->insert(
						$wpdb->prefix . 'fair_audience_event_participants',
						array(
							'event_id'       => $event_date ? (int) $event_date->get_resolved_event_id() : 0,
							'event_date_id'  => $event_date ? (int) $event_date->id : 0,
							'participant_id' => $participant_id,
							'label'          => 'signed_up',
							'ticket_type_id' => $ticket_type_id ? $ticket_type_id : null,
						),
						array( '%d', '%d', '%d', '%s', '%d' )
					);

					return rest_ensure_response( array( 'participant_id' => $participant_id ) );
				},
			)
		);
	}
);
