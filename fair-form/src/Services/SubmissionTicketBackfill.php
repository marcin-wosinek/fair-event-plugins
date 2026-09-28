<?php
/**
 * Submission Ticket Backfill
 *
 * @package FairForm
 */

namespace FairForm\Services;

use FairForm\Database\QuestionnaireSubmissionRepository;
use FairForm\Models\QuestionnaireSubmission;

defined( 'WPINC' ) || die;

/**
 * Attaches signup submissions collected before submissions recorded their
 * ticket to a ticket, following one deterministic rule:
 *
 * 1. Candidates are submissions that existed when the backfill started, have
 *    no ticket link yet, carry an event date, and have no form_id (a
 *    standalone Fair Form block sets one). Submissions titled "Fair Form" or
 *    "Audience Signup" come from fair-form's and fair-audience's non-ticket
 *    routes and are left alone.
 * 2. Among the fair-events signups of the same participant on the same event
 *    date, the earliest (by creation time, then ID) is chosen, and its first
 *    ticket (by position, then ID). Only tickets that existed when the
 *    backfill started are considered.
 * 3. The link is marked inferred, which the admin views flag for review,
 *    because the original submission did not record its purchase.
 * 4. With no matching ticket — no participant, no signup, or the chosen
 *    ticket already holds another submission — the submission stays at
 *    participant scope, marked unresolved.
 *
 * Restartable and idempotent: each candidate is examined once, and direct or
 * previously examined links are never changed. Runs a batch per request
 * once fair-events has created ticket units for every signup.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class SubmissionTicketBackfill {

	/**
	 * Option set once every candidate has been examined.
	 */
	const DONE_OPTION = 'fair_form_submission_ticket_backfilled';

	/**
	 * Option holding the highest submission and ticket IDs when the backfill
	 * started. Rows created later are never part of it.
	 */
	const CUTOFF_OPTION = 'fair_form_submission_ticket_cutoff';

	/**
	 * Option counting what the backfill attached and could not attach.
	 */
	const REPORT_OPTION = 'fair_form_submission_ticket_report';

	/**
	 * Submissions examined per request.
	 */
	const BATCH_SIZE = 200;

	/**
	 * Titles of submissions written by routes that never create a ticket.
	 * Stored untranslated on English sites; translated titles are not
	 * recognized and fall through to the matching rule.
	 *
	 * @var string[]
	 */
	const NON_SIGNUP_TITLES = array( 'Fair Form', 'Audience Signup' );

	/**
	 * Run one batch unless the backfill is finished or tickets are not
	 * available yet.
	 *
	 * @return void
	 */
	public static function maybe_run() {
		if ( get_option( self::DONE_OPTION ) || ! self::available() ) {
			return;
		}

		if ( self::run_batch( self::BATCH_SIZE ) ) {
			update_option( self::DONE_OPTION, gmdate( 'Y-m-d H:i:s' ) );
		}
	}

	/**
	 * Whether fair-events is active and has created ticket units for every
	 * signup, so a submission's ticket can be looked up.
	 *
	 * @return bool
	 */
	public static function available() {
		if ( ! class_exists( '\FairEvents\Models\EventTicket' ) ) {
			return false;
		}

		if ( class_exists( '\FairEvents\Services\TicketBackfill' ) ) {
			return 'complete' === \FairEvents\Services\TicketBackfill::get_state()['status'];
		}

		return true;
	}

	/**
	 * Examine up to $limit candidates not examined yet.
	 *
	 * @param int $limit Maximum submissions to examine.
	 * @return bool True when no candidate is left to examine.
	 */
	public static function run_batch( $limit ) {
		global $wpdb;

		$submissions_table = $wpdb->prefix . 'fair_audience_questionnaire_submissions';

		$cutoff = get_option( self::CUTOFF_OPTION );
		if ( ! is_array( $cutoff ) ) {
			add_option(
				self::CUTOFF_OPTION,
				array(
					'submission_id' => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COALESCE(MAX(id), 0) FROM %i', $submissions_table ) ),
					'ticket_id'     => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COALESCE(MAX(id), 0) FROM %i', \FairEvents\Models\EventTicket::table() ) ),
				),
				'',
				false
			);
			$cutoff = get_option( self::CUTOFF_OPTION );
		}

		$candidates = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, participant_id, event_date_id FROM %i
				 WHERE id <= %d
				 AND ticket_link IS NULL
				 AND ticket_id IS NULL
				 AND event_date_id IS NOT NULL
				 AND ( form_id IS NULL OR form_id = '' )
				 AND title NOT IN ( %s, %s )
				 ORDER BY id ASC
				 LIMIT %d",
				$submissions_table,
				(int) $cutoff['submission_id'],
				self::NON_SIGNUP_TITLES[0],
				self::NON_SIGNUP_TITLES[1],
				(int) $limit
			)
		);

		$repository = new QuestionnaireSubmissionRepository();
		$report     = self::get_report();

		foreach ( $candidates as $candidate ) {
			$ticket_id = $candidate->participant_id
				? self::find_ticket( (int) $candidate->participant_id, (int) $candidate->event_date_id, (int) $cutoff['ticket_id'] )
				: 0;

			if ( $ticket_id && ! $repository->get_by_ticket_ids( array( $ticket_id ) ) ) {
				$repository->set_ticket_link( (int) $candidate->id, $ticket_id, QuestionnaireSubmission::LINK_INFERRED );
				++$report['inferred'];
			} else {
				$repository->set_ticket_link( (int) $candidate->id, null, QuestionnaireSubmission::LINK_UNRESOLVED );
				++$report['unresolved'];
			}
		}

		update_option( self::REPORT_OPTION, $report, false );

		return count( $candidates ) < (int) $limit;
	}

	/**
	 * What the backfill has attached and could not attach so far.
	 *
	 * @return array{inferred: int, unresolved: int}
	 */
	public static function get_report() {
		$report = get_option( self::REPORT_OPTION, array() );
		$report = is_array( $report ) ? $report : array();

		return array(
			'inferred'   => (int) ( $report['inferred'] ?? 0 ),
			'unresolved' => (int) ( $report['unresolved'] ?? 0 ),
		);
	}

	/**
	 * First ticket of the participant's earliest signup on the event date.
	 *
	 * @param int $participant_id Participant ID.
	 * @param int $event_date_id  Event date ID.
	 * @param int $max_ticket_id  Highest ticket ID when the backfill started.
	 * @return int Ticket ID, or 0 when none matches.
	 */
	private static function find_ticket( $participant_id, $event_date_id, $max_ticket_id ) {
		global $wpdb;

		return (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT t.id FROM %i AS t
				 INNER JOIN %i AS s ON s.id = t.signup_id
				 WHERE s.participant_id = %d
				 AND s.event_date_id = %d
				 AND t.event_date_id = %d
				 AND t.id <= %d
				 ORDER BY s.created_at ASC, s.id ASC, t.unit_position ASC, t.id ASC
				 LIMIT 1',
				\FairEvents\Models\EventTicket::table(),
				$wpdb->prefix . 'fair_events_signups',
				$participant_id,
				$event_date_id,
				$event_date_id,
				$max_ticket_id
			)
		);
	}
}
