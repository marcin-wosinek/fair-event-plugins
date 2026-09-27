<?php
/**
 * Plugin Name: Fair Events E2E Ticket Activities
 * Description: Test-only routes for the per-ticket activities and attendance
 *              API specs, loaded ONLY inside the Playwright wp-env instance.
 *              Reads ticket and participant-level state, seeds the
 *              participant-level history recorded before activities were
 *              stored per ticket, runs the history backfill, and drives the
 *              add-on payment confirmation and hold lapse that production
 *              reaches through webhooks and time.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- test-only fixture routes.

add_action(
	'rest_api_init',
	static function () {
		if ( ! class_exists( '\FairEvents\Models\EventTicketActivity' ) || ! class_exists( '\FairAudience\Services\TicketHistoryBackfill' ) ) {
			return;
		}

		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		// Tickets of the given signups with their activities, a
		// relationship's participant-level records, and an option's count.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-activities/state',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$tickets = array();
					foreach ( (array) $request->get_param( 'signup_ids' ) as $signup_id ) {
						foreach ( \FairEvents\Models\EventTicket::get_by_signup_id( absint( $signup_id ) ) as $ticket ) {
							$tickets[] = $ticket;
						}
					}
					$activities = \FairEvents\Models\EventTicketActivity::get_by_ticket_ids( wp_list_pluck( $tickets, 'id' ) );
					foreach ( $tickets as $ticket ) {
						$ticket->activities = $activities[ (int) $ticket->id ] ?? array();
					}

					$state = array( 'tickets' => $tickets );

					$event_participant_id = absint( $request->get_param( 'event_participant_id' ) );
					if ( $event_participant_id ) {
						$state['relationship']        = $wpdb->get_row(
							$wpdb->prepare(
								'SELECT id, attended_at, attended_ticket_id, ticket_history_checked_at FROM %i WHERE id = %d',
								$wpdb->prefix . 'fair_audience_event_participants',
								$event_participant_id
							)
						);
						$state['participant_options'] = $wpdb->get_results(
							$wpdb->prepare(
								'SELECT ticket_option_id, status, ticket_id FROM %i WHERE event_participant_id = %d ORDER BY ticket_option_id',
								$wpdb->prefix . 'fair_audience_event_participant_options',
								$event_participant_id
							)
						);
					}

					$option_id = absint( $request->get_param( 'option_id' ) );
					if ( $option_id ) {
						$state['option_count'] = ( new \FairAudience\Database\EventParticipantRepository() )->count_signups_for_ticket_option( $option_id );
					}

					return rest_ensure_response( $state );
				},
			)
		);

		// Record participant-level activities and a check-in on a
		// relationship, as before activities were stored per ticket, and
		// mark it as not yet examined by the backfill.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-activities/history',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$event_participant_id = absint( $request->get_param( 'event_participant_id' ) );
					foreach ( (array) $request->get_param( 'option_ids' ) as $option_id ) {
						$wpdb->replace(
							$wpdb->prefix . 'fair_audience_event_participant_options',
							array(
								'event_participant_id' => $event_participant_id,
								'ticket_option_id'     => absint( $option_id ),
								'ticket_option_name'   => 'Historical activity',
								'status'               => 'confirmed',
							),
							array( '%d', '%d', '%s', '%s' )
						);
					}

					$attended_at = (string) $request->get_param( 'attended_at' );
					$wpdb->query(
						$wpdb->prepare(
							'UPDATE %i SET attended_at = NULLIF(%s, \'\'), attended_ticket_id = NULL, ticket_history_checked_at = NULL WHERE id = %d',
							$wpdb->prefix . 'fair_audience_event_participants',
							$attended_at,
							$event_participant_id
						)
					);

					return rest_ensure_response( array( 'event_participant_id' => $event_participant_id ) );
				},
			)
		);

		// Run the history backfill from a fresh start, as the upgrade does.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-activities/backfill',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function () {
					delete_option( \FairAudience\Services\TicketHistoryBackfill::DONE_OPTION );
					delete_option( \FairAudience\Services\TicketHistoryBackfill::CUTOFF_OPTION );

					$done = \FairAudience\Services\TicketHistoryBackfill::run_batch( 100000 );
					update_option( \FairAudience\Services\TicketHistoryBackfill::DONE_OPTION, gmdate( 'Y-m-d H:i:s' ) );

					return rest_ensure_response( array( 'done' => $done ) );
				},
			)
		);

		// Confirm an add-on payment as the payment webhook would.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-activities/pay-addon',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					$transaction = \FairPaymentsConnector\Models\Transaction::get_by_id( absint( $request->get_param( 'transaction_id' ) ) );
					if ( ! $transaction ) {
						return new WP_Error( 'no_transaction', 'Transaction not found.', array( 'status' => 400 ) );
					}

					\FairAudience\Hooks\PaymentHooks::handle_activities_added_paid( (object) array(), $transaction );

					return rest_ensure_response( array( 'paid' => true ) );
				},
			)
		);

		// Let a ticket's add-on holds run out and run the expiry cleanup.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-activities/lapse-addon',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$wpdb->query(
						$wpdb->prepare(
							'UPDATE %i SET expires_at = %s WHERE ticket_id = %d AND status = %s',
							\FairEvents\Models\EventTicketActivity::table(),
							gmdate( 'Y-m-d H:i:s', time() - MINUTE_IN_SECONDS ),
							absint( $request->get_param( 'ticket_id' ) ),
							'pending_payment'
						)
					);

					$released = ( new \FairAudience\Database\EventParticipantRepository() )->delete_expired_pending_options();

					return rest_ensure_response( array( 'released' => $released ) );
				},
			)
		);
	}
);
