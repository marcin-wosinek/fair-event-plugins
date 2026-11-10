<?php
/**
 * Plugin Name: Fair Events E2E Ticket Transfers
 * Description: Test-only fixtures for ticket holder changes (#2133): read the
 *              stored transfer history and a purchase's payment links, make
 *              the next history write fail, and anonymize a participant.
 *              Loaded ONLY inside the Playwright wp-env instance (mounted via
 *              the `mappings` entry in .wp-env.json). Never shipped to
 *              production and never mounted by the dev `docker compose` stack.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- test-only fixture routes.

// Fail the write that records a holder change.
add_filter(
	'query',
	static function ( $query ) {
		global $wpdb;

		if ( 0 !== strpos( $query, "INSERT INTO `{$wpdb->prefix}fair_events_ticket_transfers`" ) ) {
			return $query;
		}
		if ( ! get_option( 'fair_e2e_fail_ticket_transfer' ) ) {
			return $query;
		}

		$wpdb->suppress_errors( true );
		return 'SELECT fair_e2e_ticket_transfer_failed_on_purpose FROM';
	}
);

add_action(
	'rest_api_init',
	static function () {
		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		// The stored transfer rows of some tickets, and a purchase's payment
		// links, straight from the tables.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-transfers',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$ticket_ids = array_values( array_filter( array_map( 'absint', (array) $request->get_param( 'ticket_ids' ) ) ) );
					$rows       = $ticket_ids
						? $wpdb->get_results(
							$wpdb->prepare(
								'SELECT * FROM %i WHERE ticket_id IN (' . implode( ', ', array_fill( 0, count( $ticket_ids ), '%d' ) ) . ') ORDER BY id ASC',
								array_merge( array( $wpdb->prefix . 'fair_events_ticket_transfers' ), $ticket_ids )
							),
							ARRAY_A
						)
						: array();

					$signup_id = absint( $request->get_param( 'signup_id' ) );
					$links     = $signup_id && class_exists( '\FairEvents\Models\SignupPaymentLink' )
						? \FairEvents\Models\SignupPaymentLink::get_by_signup_id( $signup_id )
						: array();

					return rest_ensure_response(
						array(
							'transfers' => array_map(
								static function ( $row ) {
									return array(
										'id'         => (int) $row['id'],
										'ticket_id'  => (int) $row['ticket_id'],
										'from_participant_id' => null === $row['from_participant_id'] ? null : (int) $row['from_participant_id'],
										'to_participant_id' => null === $row['to_participant_id'] ? null : (int) $row['to_participant_id'],
										'user_id'    => (int) $row['user_id'],
										'created_at' => $row['created_at'],
									);
								},
								$rows
							),
							'links'     => $links,
						)
					);
				},
			)
		);

		// Make the next holder changes fail at the history write, or stop.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-transfers/fail',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					if ( $request->get_param( 'enabled' ) ) {
						update_option( 'fair_e2e_fail_ticket_transfer', 1, false );
					} else {
						delete_option( 'fair_e2e_fail_ticket_transfer' );
					}

					return rest_ensure_response( array( 'enabled' => (bool) get_option( 'fair_e2e_fail_ticket_transfer' ) ) );
				},
			)
		);

		// Anonymize a participant as a data deletion request does.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-transfers/anonymize',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					$participant = ( new \FairAudience\Database\ParticipantRepository() )->get_by_id( absint( $request->get_param( 'participant_id' ) ) );
					if ( ! $participant ) {
						return new WP_Error( 'not_found', 'Participant not found.', array( 'status' => 404 ) );
					}

					return rest_ensure_response(
						array( 'anonymized' => \FairAudience\Services\ParticipantAnonymizationService::anonymize( $participant ) )
					);
				},
			)
		);
	}
);
