<?php
/**
 * Plugin Name: Fair Events E2E Participant Removal
 * Description: Test-only fixtures for removing a participant from an event
 *              date: read what a removal left behind, add a registration
 *              awaiting payment, and make the next removal fail after its
 *              writes. Loaded ONLY inside the Playwright wp-env instance
 *              (mounted via the `mappings` entry in .wp-env.json). Never
 *              shipped to production and never mounted by the dev
 *              `docker compose` stack.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- test-only fixture routes.

// Fail a removal after its writes, to show they are rolled back.
add_action(
	'fair_audience_event_participant_removed',
	static function () {
		if ( get_option( 'fair_e2e_fail_participant_removal' ) ) {
			throw new RuntimeException( 'fair-e2e: participant removal failed on purpose.' );
		}
	}
);

add_action(
	'rest_api_init',
	static function () {
		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		// What is stored for a relationship and its participant.
		register_rest_route(
			'fair-e2e/v1',
			'/participant-removal/records',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$event_participant_id = absint( $request->get_param( 'event_participant_id' ) );
					$participant_id       = absint( $request->get_param( 'participant_id' ) );
					$count                = static function ( $table, $column, $value ) use ( $wpdb ) {
						return (int) $wpdb->get_var(
							$wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE %i = %d', $wpdb->prefix . $table, $column, $value )
						);
					};

					return rest_ensure_response(
						array(
							'relationship'  => $count( 'fair_audience_event_participants', 'id', $event_participant_id ),
							'activities'    => $count( 'fair_audience_event_participant_options', 'event_participant_id', $event_participant_id ),
							'relationships' => $count( 'fair_audience_event_participants', 'participant_id', $participant_id ),
							'participant'   => $count( 'fair_audience_participants', 'id', $participant_id ),
							'signups'       => $count( 'fair_events_signups', 'participant_id', $participant_id ),
							'tickets'       => $count( 'fair_events_tickets', 'holder_participant_id', $participant_id ),
						)
					);
				},
			)
		);

		// Insert a registration awaiting payment for a participant, with a
		// hold running out in `expires_in` seconds (negative: already out).
		register_rest_route(
			'fair-e2e/v1',
			'/participant-removal/pending-signup',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$wpdb->insert(
						$wpdb->prefix . 'fair_events_signups',
						array(
							'event_date_id'      => absint( $request->get_param( 'event_date_id' ) ),
							'name'               => 'Pending Buyer',
							'email'              => sanitize_email( (string) $request->get_param( 'email' ) ),
							'quantity'           => 1,
							'status'             => 'pending_payment',
							'participant_id'     => absint( $request->get_param( 'participant_id' ) ),
							'payment_expires_at' => gmdate( 'Y-m-d H:i:s', time() + (int) $request->get_param( 'expires_in' ) ),
							'created_at'         => current_time( 'mysql' ),
						),
						array( '%d', '%s', '%s', '%d', '%s', '%d', '%s', '%s' )
					);

					return rest_ensure_response( array( 'signup_id' => (int) $wpdb->insert_id ) );
				},
			)
		);

		// Make removals fail after their writes, or stop doing so.
		register_rest_route(
			'fair-e2e/v1',
			'/participant-removal/fail',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					if ( $request->get_param( 'enabled' ) ) {
						update_option( 'fair_e2e_fail_participant_removal', 1, false );
					} else {
						delete_option( 'fair_e2e_fail_participant_removal' );
					}

					return rest_ensure_response( array( 'enabled' => (bool) $request->get_param( 'enabled' ) ) );
				},
			)
		);
	}
);
