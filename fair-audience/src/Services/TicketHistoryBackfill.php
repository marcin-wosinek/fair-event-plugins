<?php
/**
 * Ticket History Backfill
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Carries historical participant-level activities and attendance over to
 * individual tickets, only where the attribution is unambiguous.
 *
 * A relationship recorded before the backfill started is attributed when
 * its participant held exactly one active ticket on that event date at the
 * time: its activities and check-in are copied onto that ticket, and the
 * participant-level records are kept, marked as carried over. With no
 * ticket or several, nothing is copied and the records stay visible at
 * participant scope. Each relationship is examined once.
 *
 * Restartable and idempotent: relationships are processed in batches and
 * marked as checked; copying never overwrites what a ticket already records,
 * so a batch interrupted half-way is safe to repeat.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class TicketHistoryBackfill {

	/**
	 * Option set once every eligible relationship has been examined.
	 */
	const DONE_OPTION = 'fair_audience_ticket_history_backfilled';

	/**
	 * Option holding the highest relationship and ticket IDs when the
	 * backfill started. Relationships and tickets created later are never
	 * part of it. IDs rather than timestamps, since relationship and ticket
	 * creation times are recorded in different time zones.
	 */
	const CUTOFF_OPTION = 'fair_audience_ticket_history_cutoff';

	/**
	 * Relationships examined per request.
	 */
	const BATCH_SIZE = 200;

	/**
	 * Run one batch unless the backfill is finished or fair-events cannot
	 * store per-ticket data yet.
	 *
	 * @return void
	 */
	public static function maybe_run() {
		if ( get_option( self::DONE_OPTION ) || ! TicketActivities::available() ) {
			return;
		}

		if ( self::run_batch( self::BATCH_SIZE ) ) {
			update_option( self::DONE_OPTION, gmdate( 'Y-m-d H:i:s' ) );
		}
	}

	/**
	 * Examine up to $limit relationships not examined yet.
	 *
	 * @param int $limit Maximum relationships to examine.
	 * @return bool True when no relationship is left to examine.
	 */
	public static function run_batch( $limit ) {
		global $wpdb;

		$cutoff = get_option( self::CUTOFF_OPTION );
		if ( ! is_array( $cutoff ) ) {
			add_option(
				self::CUTOFF_OPTION,
				array(
					'relationship_id' => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COALESCE(MAX(id), 0) FROM %i', self::relationships_table() ) ),
					'ticket_id'       => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COALESCE(MAX(id), 0) FROM %i', \FairEvents\Models\EventTicket::table() ) ),
				),
				'',
				false
			);
			$cutoff = get_option( self::CUTOFF_OPTION );
		}

		$relationships = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, event_date_id, participant_id, attended_at FROM %i AS ep
				 WHERE ep.ticket_history_checked_at IS NULL
				 AND ep.id <= %d
				 AND ( ep.attended_at IS NOT NULL
				     OR EXISTS ( SELECT 1 FROM %i AS epo WHERE epo.event_participant_id = ep.id AND epo.ticket_id IS NULL ) )
				 ORDER BY ep.id ASC
				 LIMIT %d',
				self::relationships_table(),
				(int) $cutoff['relationship_id'],
				self::options_table(),
				(int) $limit
			)
		);

		foreach ( $relationships as $relationship ) {
			self::attribute( $relationship, (int) $cutoff['ticket_id'] );
		}

		return count( $relationships ) < (int) $limit;
	}

	/**
	 * Copy one relationship's history onto its only ticket, if it has
	 * exactly one, and mark the relationship as examined.
	 *
	 * @param object $relationship  Relationship row (id, event_date_id, participant_id, attended_at).
	 * @param int    $max_ticket_id Highest ticket ID when the backfill started.
	 * @return void
	 */
	private static function attribute( $relationship, $max_ticket_id ) {
		global $wpdb;

		$tickets = array_values(
			array_filter(
				\FairEvents\Models\EventTicket::get_held_on_event_date( (int) $relationship->event_date_id, (int) $relationship->participant_id ),
				static fn( $ticket ) => (int) $ticket->id <= $max_ticket_id
			)
		);

		if ( 1 === count( $tickets ) ) {
			$ticket_id = (int) $tickets[0]->id;

			$option_rows = $wpdb->get_results(
				$wpdb->prepare(
					'SELECT id, ticket_option_id, ticket_option_name, status, expires_at FROM %i WHERE event_participant_id = %d AND ticket_id IS NULL',
					self::options_table(),
					(int) $relationship->id
				)
			);
			foreach ( $option_rows as $option_row ) {
				\FairEvents\Models\EventTicketActivity::insert_missing(
					$ticket_id,
					(int) $option_row->ticket_option_id,
					(string) $option_row->ticket_option_name,
					(string) $option_row->status,
					$option_row->expires_at
				);
				$wpdb->update(
					self::options_table(),
					array( 'ticket_id' => $ticket_id ),
					array( 'id' => (int) $option_row->id ),
					array( '%d' ),
					array( '%d' )
				);
			}

			if ( ! empty( $relationship->attended_at ) ) {
				\FairEvents\Models\EventTicket::set_attended( $ticket_id, true, (string) $relationship->attended_at );
				$wpdb->update(
					self::relationships_table(),
					array( 'attended_ticket_id' => $ticket_id ),
					array( 'id' => (int) $relationship->id ),
					array( '%d' ),
					array( '%d' )
				);
			}
		}

		$wpdb->update(
			self::relationships_table(),
			array( 'ticket_history_checked_at' => current_time( 'mysql' ) ),
			array( 'id' => (int) $relationship->id ),
			array( '%s' ),
			array( '%d' )
		);
	}

	/**
	 * Relationships table name.
	 *
	 * @return string
	 */
	private static function relationships_table() {
		global $wpdb;

		return $wpdb->prefix . 'fair_audience_event_participants';
	}

	/**
	 * Participant-level activities table name.
	 *
	 * @return string
	 */
	private static function options_table() {
		global $wpdb;

		return $wpdb->prefix . 'fair_audience_event_participant_options';
	}
}
