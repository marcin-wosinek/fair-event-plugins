<?php
/**
 * Plugin Name: Fair Form E2E Submission Tickets
 * Description: Test-only routes for the per-ticket Fair Form answers API
 *              specs, loaded ONLY inside the Playwright wp-env instance.
 *              Seeds signup submissions recorded before submissions named
 *              their ticket, runs the backfill that attaches them, reads the
 *              stored link, and reduces a signup's quantity as an
 *              administrator's edit would.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- test-only fixture routes.

add_action(
	'rest_api_init',
	static function () {
		if ( ! class_exists( '\FairForm\Services\SubmissionTicketBackfill' ) || ! class_exists( '\FairEvents\Models\EventTicket' ) ) {
			return;
		}

		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		// Store a submission the way it was stored before submissions
		// recorded their ticket: no ticket and no link.
		register_rest_route(
			'fair-e2e/v1',
			'/submission-tickets/legacy',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$participant_id = absint( $request->get_param( 'participant_id' ) );
					$data           = array(
						'event_date_id' => absint( $request->get_param( 'event_date_id' ) ),
						'title'         => (string) ( $request->get_param( 'title' ) ?? 'Event Signup' ),
					);
					if ( $participant_id ) {
						$data['participant_id'] = $participant_id;
					}
					if ( $request->get_param( 'form_id' ) ) {
						$data['form_id'] = (string) $request->get_param( 'form_id' );
					}
					$wpdb->insert( $wpdb->prefix . 'fair_audience_questionnaire_submissions', $data );
					$submission_id = (int) $wpdb->insert_id;

					( new \FairForm\Database\QuestionnaireAnswerRepository() )->save_answers(
						$submission_id,
						array(
							array(
								'question_key'  => 'diet',
								'question_text' => 'Dietary needs?',
								'question_type' => 'short_text',
								'answer_value'  => (string) $request->get_param( 'answer' ),
								'display_order' => 0,
							),
						)
					);

					return rest_ensure_response( array( 'id' => $submission_id ) );
				},
			)
		);

		// Run the backfill from a fresh start, as the upgrade does.
		register_rest_route(
			'fair-e2e/v1',
			'/submission-tickets/backfill',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					$backfill = \FairForm\Services\SubmissionTicketBackfill::class;

					if ( $request->get_param( 'restart' ) ) {
						delete_option( $backfill::DONE_OPTION );
						delete_option( $backfill::CUTOFF_OPTION );
						delete_option( $backfill::REPORT_OPTION );
					}

					$done = $backfill::run_batch( 100000 );
					update_option( $backfill::DONE_OPTION, gmdate( 'Y-m-d H:i:s' ) );

					return rest_ensure_response(
						array(
							'done'   => $done,
							'report' => $backfill::get_report(),
						)
					);
				},
			)
		);

		// The stored ticket link of the given submissions.
		register_rest_route(
			'fair-e2e/v1',
			'/submission-tickets/state',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					$repository = new \FairForm\Database\QuestionnaireSubmissionRepository();

					$submissions = array();
					foreach ( (array) $request->get_param( 'ids' ) as $id ) {
						$submission = $repository->get_by_id( absint( $id ) );
						if ( $submission ) {
							$submissions[] = array(
								'id'          => (int) $submission->id,
								'ticket_id'   => $submission->ticket_id,
								'ticket_link' => $submission->ticket_link,
							);
						}
					}

					return rest_ensure_response( $submissions );
				},
			)
		);

		// Reduce a signup's quantity and bring its tickets in line, removing
		// the tickets beyond it.
		register_rest_route(
			'fair-e2e/v1',
			'/submission-tickets/reduce',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$signup_id = absint( $request->get_param( 'signup_id' ) );
					$wpdb->update(
						$wpdb->prefix . 'fair_events_signups',
						array( 'quantity' => max( 1, absint( $request->get_param( 'quantity' ) ) ) ),
						array( 'id' => $signup_id ),
						array( '%d' ),
						array( '%d' )
					);
					\FairEvents\Models\EventTicket::reconcile_signup( \FairEvents\Models\EventSignup::get_by_id( $signup_id ) );

					return rest_ensure_response( \FairEvents\Models\EventTicket::get_by_signup_id( $signup_id ) );
				},
			)
		);

		// Attach a submission to a ticket, as a direct link.
		register_rest_route(
			'fair-e2e/v1',
			'/submission-tickets/link',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					( new \FairForm\Database\QuestionnaireSubmissionRepository() )->set_ticket_link(
						absint( $request->get_param( 'id' ) ),
						absint( $request->get_param( 'ticket_id' ) ),
						\FairForm\Models\QuestionnaireSubmission::LINK_DIRECT
					);

					return rest_ensure_response( array( 'id' => absint( $request->get_param( 'id' ) ) ) );
				},
			)
		);
	}
);
