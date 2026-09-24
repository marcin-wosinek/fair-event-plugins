<?php
/**
 * Plugin Name: Fair Events E2E Ticket Units
 * Description: Test-only routes for fair-events ticket unit API specs, loaded
 *              ONLY inside the Playwright wp-env instance. Seeds signups that
 *              predate ticket units, tampers with unit counts, drives signup
 *              lifecycle transitions that need a payment provider, and runs
 *              the ticket backfill synchronously.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- test-only fixture routes.

// Specs drive backfill batches synchronously through the route below; a
// real WP-Cron batch firing between requests would race them.
add_filter(
	'pre_schedule_event',
	static function ( $result, $event ) {
		if ( class_exists( '\FairEvents\Services\TicketBackfill' )
			&& \FairEvents\Services\TicketBackfill::CRON_HOOK === $event->hook
		) {
			return false;
		}
		return $result;
	},
	10,
	2
);

add_action(
	'rest_api_init',
	static function () {
		if ( ! class_exists( '\FairEvents\Models\EventTicket' ) ) {
			return;
		}

		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		// A signup's row and its ticket units.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-units/(?P<signup_id>\d+)',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$signup_id = absint( $request['signup_id'] );
					$signup    = \FairEvents\Models\EventSignup::get_by_id( $signup_id );

					// Participant-level records the units must not multiply.
					$participants      = null;
					$event_participant = null;
					if ( $signup && class_exists( '\FairAudience\Database\ParticipantRepository' ) ) {
						$participants = (int) $wpdb->get_var(
							$wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE email = %s', $wpdb->prefix . 'fair_audience_participants', $signup->email )
						);
						if ( $signup->participant_id ) {
							$event_participant = (int) $wpdb->get_var(
								$wpdb->prepare(
									'SELECT COUNT(*) FROM %i WHERE event_date_id = %d AND participant_id = %d',
									$wpdb->prefix . 'fair_audience_event_participants',
									$signup->event_date_id,
									$signup->participant_id
								)
							);
						}
					}

					return rest_ensure_response(
						array(
							'signup'                   => $signup,
							'tickets'                  => \FairEvents\Models\EventTicket::get_by_signup_id( $signup_id ),
							'participants_with_email'  => $participants,
							'event_participation_rows' => $event_participant,
						)
					);
				},
			)
		);

		// Insert signup rows directly, without units, as they existed before
		// ticket units were introduced.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-units/legacy-signups',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$ids = array();
					foreach ( (array) $request->get_param( 'signups' ) as $signup ) {
						$wpdb->insert(
							$wpdb->prefix . 'fair_events_signups',
							array(
								'event_date_id'  => absint( $request->get_param( 'event_date_id' ) ),
								'name'           => 'Legacy Buyer',
								'email'          => sanitize_email( (string) $request->get_param( 'email' ) ),
								'quantity'       => absint( $signup['quantity'] ?? 1 ),
								'status'         => sanitize_key( $signup['status'] ?? 'confirmed' ),
								'participant_id' => ! empty( $signup['participant_id'] ) ? absint( $signup['participant_id'] ) : null,
								'transaction_id' => ! empty( $signup['transaction_id'] ) ? absint( $signup['transaction_id'] ) : null,
								'created_at'     => current_time( 'mysql' ),
							),
							array( '%d', '%s', '%s', '%d', '%s', '%d', '%d', '%s' )
						);
						$ids[] = (int) $wpdb->insert_id;
					}

					return rest_ensure_response( array( 'signup_ids' => $ids ) );
				},
			)
		);

		// Simulate an interrupted or corrupted backfill for one signup.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-units/tamper',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$table     = $wpdb->prefix . 'fair_events_tickets';
					$signup_id = absint( $request->get_param( 'signup_id' ) );
					$position  = absint( $request->get_param( 'position' ) );

					if ( 'remove' === $request->get_param( 'action' ) ) {
						$wpdb->delete(
							$table,
							array(
								'signup_id'     => $signup_id,
								'unit_position' => $position,
							),
							array( '%d', '%d' )
						);
					} else {
						$signup = \FairEvents\Models\EventSignup::get_by_id( $signup_id );
						$wpdb->insert(
							$table,
							array(
								'reference'     => \FairEvents\Models\EventTicket::generate_reference(),
								'signup_id'     => $signup_id,
								'unit_position' => $position,
								'event_date_id' => $signup ? (int) $signup->event_date_id : 0,
								'status'        => $signup ? $signup->status : 'confirmed',
							),
							array( '%s', '%d', '%d', '%d', '%s' )
						);
					}

					return rest_ensure_response( \FairEvents\Services\TicketBackfill::audit() );
				},
			)
		);

		// Run lifecycle transitions that production reaches through payment
		// webhooks, checkout retry/cancel, expiry cron, or participant deletion.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-units/transition',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$signup_id = absint( $request->get_param( 'signup_id' ) );
					$result    = null;

					switch ( $request->get_param( 'action' ) ) {
						case 'hold':
							$result = \FairEvents\Models\EventSignup::update_transaction( $signup_id, absint( $request->get_param( 'transaction_id' ) ), 'pending_payment' );
							break;
						case 'confirm_paid':
							$result = \FairEvents\Models\EventSignup::confirm_paid( $signup_id );
							break;
						case 'fail_pending':
							$result = \FairEvents\Models\EventSignup::fail_pending( $signup_id );
							break;
						case 'cancel_pending':
							$result = \FairEvents\Models\EventSignup::cancel_pending( $signup_id );
							break;
						case 'expire':
							$wpdb->update(
								$wpdb->prefix . 'fair_events_signups',
								array( 'payment_expires_at' => gmdate( 'Y-m-d H:i:s', time() - MINUTE_IN_SECONDS ) ),
								array( 'id' => $signup_id ),
								array( '%s' ),
								array( '%d' )
							);
							$result = \FairEvents\Models\EventSignup::expire_pending();
							break;
						case 'anonymize':
							$participant = ( new \FairAudience\Database\ParticipantRepository() )->get_by_id( absint( $request->get_param( 'participant_id' ) ) );
							$result      = $participant && \FairAudience\Services\ParticipantAnonymizationService::anonymize( $participant );
							break;
						case 'backfill_participants':
							$result = \FairAudience\Hooks\SignupHookBridge::backfill_signup_participant_ids();
							break;
						default:
							return new WP_Error( 'unknown_action', 'Unknown action.', array( 'status' => 400 ) );
					}

					return rest_ensure_response(
						array(
							'result'  => $result,
							'signup'  => \FairEvents\Models\EventSignup::get_by_id( $signup_id ),
							'tickets' => \FairEvents\Models\EventTicket::get_by_signup_id( $signup_id ),
						)
					);
				},
			)
		);

		// Restart the backfill from a cursor and run a bounded number of
		// batches synchronously, as the cron handler would.
		register_rest_route(
			'fair-e2e/v1',
			'/ticket-units/backfill',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					$backfill = \FairEvents\Services\TicketBackfill::class;

					wp_clear_scheduled_hook( $backfill::CRON_HOOK );

					if ( $request->get_param( 'restart' ) ) {
						update_option(
							$backfill::OPTION,
							array(
								'status'         => 'running',
								'last_signup_id' => absint( $request->get_param( 'last_signup_id' ) ),
								'completed_at'   => null,
							)
						);
					}

					$batch_size  = max( 1, absint( $request->get_param( 'batch_size' ) ) );
					$max_batches = max( 1, absint( $request->get_param( 'max_batches' ) ) );
					for ( $i = 0; $i < $max_batches; $i++ ) {
						$state = $backfill::run_batch( $batch_size );
						if ( 'running' !== $state['status'] ) {
							break;
						}
					}

					return rest_ensure_response(
						array(
							'state' => $backfill::get_state(),
							'audit' => $backfill::audit(),
						)
					);
				},
			)
		);
	}
);
