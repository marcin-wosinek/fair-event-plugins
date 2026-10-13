<?php
/**
 * Plugin Name: Fair Events E2E Data Deletion
 * Description: Test-only fixtures for a subscriber deleting their own data
 *              from the manage-subscription page: add records related to a
 *              participant, read what a deletion left behind, and make the
 *              next deletion fail. Loaded ONLY inside the Playwright wp-env
 *              instance (mounted via the `mappings` entry in .wp-env.json).
 *              Never shipped to production and never mounted by the dev
 *              `docker compose` stack.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- test-only fixture routes.

// Fail the write that clears a participant's profile.
add_filter(
	'query',
	static function ( $query ) {
		global $wpdb;

		if ( 0 !== strpos( $query, "UPDATE {$wpdb->prefix}fair_audience_participants SET name = 'Deleted'" ) ) {
			return $query;
		}
		if ( ! get_option( 'fair_e2e_fail_data_deletion' ) ) {
			return $query;
		}

		$wpdb->suppress_errors( true );
		return 'SELECT fair_e2e_data_deletion_failed_on_purpose FROM';
	}
);

add_action(
	'rest_api_init',
	static function () {
		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		// Add an attendance record, a consent log entry, a mailing category,
		// and a signup with one ticket for a participant.
		register_rest_route(
			'fair-e2e/v1',
			'/data-deletion/related-records',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$participant_id = absint( $request->get_param( 'participant_id' ) );
					// No real event date: far outside the IDs the site hands out.
					$event_date_id = 900000000 + $participant_id;

					$wpdb->insert(
						$wpdb->prefix . 'fair_audience_event_participants',
						array(
							'event_id'       => $event_date_id,
							'event_date_id'  => $event_date_id,
							'participant_id' => $participant_id,
							'label'          => 'signed_up',
							'attended_at'    => current_time( 'mysql' ),
						),
						array( '%d', '%d', '%d', '%s', '%s' )
					);
					$wpdb->insert(
						$wpdb->prefix . 'fair_audience_email_consent_log',
						array(
							'participant_id' => $participant_id,
							'old_profile'    => 'minimal',
							'new_profile'    => 'marketing',
							'source'         => 'fair-e2e',
							'performed_by'   => get_current_user_id(),
						),
						array( '%d', '%s', '%s', '%s', '%d' )
					);
					$wpdb->insert(
						$wpdb->prefix . 'fair_audience_participant_categories',
						array(
							'participant_id' => $participant_id,
							'category_id'    => 1,
						),
						array( '%d', '%d' )
					);
					$wpdb->insert(
						$wpdb->prefix . 'fair_events_signups',
						array(
							'event_date_id'  => $event_date_id,
							'name'           => 'Synthetic Subscriber',
							'email'          => sanitize_email( (string) $request->get_param( 'email' ) ),
							'quantity'       => 1,
							'status'         => 'confirmed',
							'mailing_opt_in' => 1,
							'participant_id' => $participant_id,
							'created_at'     => current_time( 'mysql' ),
						),
						array( '%d', '%s', '%s', '%d', '%s', '%d', '%d', '%s' )
					);
					$signup_id = (int) $wpdb->insert_id;

					$wpdb->insert(
						$wpdb->prefix . 'fair_events_tickets',
						array(
							'reference'                => md5( 'fair-e2e-data-deletion-' . $signup_id ),
							'signup_id'                => $signup_id,
							'unit_position'            => 1,
							'event_date_id'            => $event_date_id,
							'purchaser_participant_id' => $participant_id,
							'holder_participant_id'    => $participant_id,
						),
						array( '%s', '%d', '%d', '%d', '%d', '%d' )
					);

					return rest_ensure_response(
						array(
							'signup_id' => $signup_id,
							'ticket_id' => (int) $wpdb->insert_id,
						)
					);
				},
			)
		);

		// What is stored for a participant and the records related to them.
		register_rest_route(
			'fair-e2e/v1',
			'/data-deletion/records',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$participant_id = absint( $request->get_param( 'participant_id' ) );
					$count          = static function ( $table ) use ( $wpdb, $participant_id ) {
						return (int) $wpdb->get_var(
							$wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE participant_id = %d', $wpdb->prefix . $table, $participant_id )
						);
					};

					return rest_ensure_response(
						array(
							'participant' => $wpdb->get_row(
								$wpdb->prepare(
									'SELECT name, surname, email, phone, instagram, email_profile, wp_user_id FROM %i WHERE id = %d',
									$wpdb->prefix . 'fair_audience_participants',
									$participant_id
								),
								ARRAY_A
							),
							'attendance'  => $count( 'fair_audience_event_participants' ),
							'consent_log' => $count( 'fair_audience_email_consent_log' ),
							'categories'  => $count( 'fair_audience_participant_categories' ),
							'signup'      => $wpdb->get_row(
								$wpdb->prepare(
									'SELECT name, email, mailing_opt_in, participant_id FROM %i WHERE id = %d',
									$wpdb->prefix . 'fair_events_signups',
									absint( $request->get_param( 'signup_id' ) )
								),
								ARRAY_A
							),
							'ticket'      => $wpdb->get_row(
								$wpdb->prepare(
									'SELECT purchaser_participant_id, holder_participant_id FROM %i WHERE id = %d',
									$wpdb->prefix . 'fair_events_tickets',
									absint( $request->get_param( 'ticket_id' ) )
								),
								ARRAY_A
							),
						)
					);
				},
			)
		);

		// Remove the records added for a participant.
		register_rest_route(
			'fair-e2e/v1',
			'/data-deletion/related-records',
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$participant_id = absint( $request->get_param( 'participant_id' ) );

					foreach ( array( 'fair_audience_event_participants', 'fair_audience_email_consent_log', 'fair_audience_participant_categories' ) as $table ) {
						$wpdb->delete( $wpdb->prefix . $table, array( 'participant_id' => $participant_id ), array( '%d' ) );
					}
					$wpdb->delete( $wpdb->prefix . 'fair_events_tickets', array( 'id' => absint( $request->get_param( 'ticket_id' ) ) ), array( '%d' ) );
					$wpdb->delete( $wpdb->prefix . 'fair_events_signups', array( 'id' => absint( $request->get_param( 'signup_id' ) ) ), array( '%d' ) );

					return rest_ensure_response( array( 'deleted' => true ) );
				},
			)
		);

		// Make deletions fail, or stop doing so.
		register_rest_route(
			'fair-e2e/v1',
			'/data-deletion/fail',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					if ( $request->get_param( 'enabled' ) ) {
						update_option( 'fair_e2e_fail_data_deletion', 1, false );
					} else {
						delete_option( 'fair_e2e_fail_data_deletion' );
					}

					return rest_ensure_response( array( 'enabled' => (bool) $request->get_param( 'enabled' ) ) );
				},
			)
		);
	}
);
