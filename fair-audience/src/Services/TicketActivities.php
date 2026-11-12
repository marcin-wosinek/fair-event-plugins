<?php
/**
 * Ticket Activities
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Reads and writes activities on fair-events' individual tickets for the
 * participant-facing flows, falling back to participant scope when
 * fair-events cannot store them per ticket.
 *
 * A participant's activity "target" is the ticket an activity belongs to,
 * or null for participant scope: signups that have no individual tickets
 * (fair-audience's own signup routes) and history from before activities
 * were stored per ticket.
 */
class TicketActivities {

	/**
	 * Database version of fair-events that stores activities and attendance
	 * per ticket.
	 */
	const REQUIRED_EVENTS_DB_VERSION = '3.38.0';

	/**
	 * Whether fair-events can store activities and attendance per ticket.
	 *
	 * @return bool
	 */
	public static function available() {
		return class_exists( \FairEvents\Models\EventTicketActivity::class )
			&& method_exists( \FairEvents\Models\EventTicket::class, 'get_held_by_participants' )
			&& class_exists( \FairEvents\Database\Schema::class )
			&& version_compare( \FairEvents\Database\Schema::get_db_version(), self::REQUIRED_EVENTS_DB_VERSION, '>=' );
	}

	/**
	 * The tickets a participant holds on an event date that can receive
	 * added activities: confirmed and not cancelled or refunded.
	 *
	 * @param int $event_date_id  Event date ID.
	 * @param int $participant_id Participant ID.
	 * @return object[]
	 */
	public static function addon_tickets( $event_date_id, $participant_id ) {
		if ( ! self::available() ) {
			return array();
		}

		return \FairEvents\Models\EventTicket::get_held_on_event_date( (int) $event_date_id, (int) $participant_id, array( 'confirmed' ) );
	}

	/**
	 * Whether a participant's admission on an event date rests on tickets:
	 * they hold or bought at least one ticket there that still admits
	 * someone, or is awaiting its payment. Removing their relationship would
	 * orphan those tickets, so they are cancelled one by one instead.
	 *
	 * @param int $event_date_id  Event date ID.
	 * @param int $participant_id Participant ID.
	 * @return bool
	 */
	public static function backs_admission( $event_date_id, $participant_id ) {
		return self::available()
			&& method_exists( \FairEvents\Models\EventTicket::class, 'count_active_for_participant' )
			&& \FairEvents\Models\EventTicket::count_active_for_participant( (int) $event_date_id, (int) $participant_id ) > 0;
	}

	/**
	 * Whether a participant holds a confirmed ticket on an event date: the
	 * ticket admits them, whoever bought it and whatever their relationship
	 * there says.
	 *
	 * @param int $event_date_id  Event date ID.
	 * @param int $participant_id Participant ID.
	 * @return bool
	 */
	public static function holds_admission_ticket( $event_date_id, $participant_id ) {
		return self::available()
			&& (bool) \FairEvents\Models\EventTicket::get_held_on_event_date( (int) $event_date_id, (int) $participant_id, array( 'confirmed' ) );
	}

	/**
	 * Of several event dates, those on which a participant holds a
	 * confirmed ticket, in one query: for the occurrence picker of a long
	 * series.
	 *
	 * @param int   $participant_id Participant ID.
	 * @param int[] $event_date_ids Event date IDs.
	 * @return int[] The event date IDs among them with such a ticket.
	 */
	public static function admitting_event_date_ids( $participant_id, array $event_date_ids ) {
		global $wpdb;

		$event_date_ids = array_values( array_unique( array_filter( array_map( 'intval', $event_date_ids ) ) ) );
		if ( ! self::available() || ! $event_date_ids ) {
			return array();
		}

		$placeholders = implode( ', ', array_fill( 0, count( $event_date_ids ), '%d' ) );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- placeholder list built above.
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT DISTINCT event_date_id FROM %i WHERE holder_participant_id = %d AND status = %s AND deleted_at IS NULL AND event_date_id IN ( $placeholders )",
				array_merge( array( \FairEvents\Models\EventTicket::table(), (int) $participant_id, 'confirmed' ), $event_date_ids )
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

		return array_map( 'intval', $ids );
	}

	/**
	 * Whether every ticket that still admits someone, among those a
	 * participant holds or bought on an event date, is one they bought and
	 * someone else now holds. Their relationship there stays, as the record
	 * of the purchase, but no longer admits them.
	 *
	 * @param int $event_date_id  Event date ID.
	 * @param int $participant_id Participant ID.
	 * @return bool
	 */
	public static function transferred_away( $event_date_id, $participant_id ) {
		if ( ! self::available()
			|| ! method_exists( \FairEvents\Models\EventTicket::class, 'count_active_for_participant' )
			|| ! method_exists( \FairEvents\Models\EventTicket::class, 'count_assigned_away' )
		) {
			return false;
		}

		$active = \FairEvents\Models\EventTicket::count_active_for_participant( (int) $event_date_id, (int) $participant_id );
		if ( ! $active ) {
			return false;
		}

		$assigned_away = \FairEvents\Models\EventTicket::count_assigned_away( (int) $event_date_id, array( (int) $participant_id ) );

		return ( $assigned_away[ (int) $participant_id ] ?? 0 ) >= $active;
	}

	/**
	 * Whether a participant is admitted to an event date. A ticket they
	 * hold admits them. Otherwise their signed-up relationship does, unless
	 * that admission rested on tickets they have all given away: buying a
	 * ticket is not attending on it.
	 *
	 * @param int         $event_date_id  Event date ID.
	 * @param int         $participant_id Participant ID.
	 * @param object|null $relationship   Their relationship on the date, if any.
	 * @param bool|null   $holds_ticket   Whether they hold a confirmed ticket there, when the caller already knows (see admitting_event_date_ids()).
	 * @return bool
	 */
	public static function admitted( $event_date_id, $participant_id, $relationship, $holds_ticket = null ) {
		if ( null === $holds_ticket ) {
			$holds_ticket = self::holds_admission_ticket( $event_date_id, $participant_id );
		}
		if ( $holds_ticket ) {
			return true;
		}

		return $relationship
			&& 'signed_up' === $relationship->label
			&& ! self::transferred_away( $event_date_id, $participant_id );
	}

	/**
	 * Describe the confirmed tickets a participant holds for an event date,
	 * each with the activities selected on it — for showing them what they
	 * already have. A whole-series pass held on the series master is included
	 * when the caller names that master.
	 *
	 * @param int      $event_date_id    Event date ID.
	 * @param int      $participant_id   Participant ID.
	 * @param int|null $series_master_id Series master whose whole-series passes also cover this date, if any.
	 * @return array<int, array{id: int, label: string, activities: string[]}>
	 */
	public static function held_ticket_summaries( $event_date_id, $participant_id, $series_master_id = null ) {
		if ( ! self::available() ) {
			return array();
		}

		$tickets = \FairEvents\Models\EventTicket::get_held_on_event_date( (int) $event_date_id, (int) $participant_id, array( 'confirmed' ) );

		if ( $series_master_id && (int) $series_master_id !== (int) $event_date_id && class_exists( \FairEvents\Models\TicketType::class ) ) {
			foreach ( \FairEvents\Models\EventTicket::get_held_on_event_date( (int) $series_master_id, (int) $participant_id, array( 'confirmed' ) ) as $ticket ) {
				$ticket_type = $ticket->ticket_type_id ? \FairEvents\Models\TicketType::get_by_id( (int) $ticket->ticket_type_id ) : null;
				if ( $ticket_type && $ticket_type->is_whole_series() ) {
					$tickets[] = $ticket;
				}
			}
		}

		if ( ! $tickets ) {
			return array();
		}

		$activity_rows = \FairEvents\Models\EventTicketActivity::get_by_ticket_ids( wp_list_pluck( $tickets, 'id' ) );
		$summaries     = array();
		foreach ( $tickets as $position => $ticket ) {
			$activities = array();
			foreach ( $activity_rows[ (int) $ticket->id ] ?? array() as $row ) {
				if ( 'confirmed' !== $row->status ) {
					continue;
				}
				// Prefer the current option name so renames are reflected;
				// fall back to the name stored with the selection.
				$option       = class_exists( \FairEvents\Models\TicketOption::class )
					? \FairEvents\Models\TicketOption::get_by_id( (int) $row->ticket_option_id )
					: null;
				$activities[] = $option && '' !== (string) $option->name ? (string) $option->name : (string) $row->ticket_option_name;
			}

			$summaries[] = array(
				'id'         => (int) $ticket->id,
				'label'      => self::ticket_label( $ticket, $position + 1 ),
				'activities' => array_values( array_filter( $activities ) ),
			);
		}

		return $summaries;
	}

	/**
	 * Resolve the ticket an add-on targets. With one eligible ticket, that
	 * ticket is used; with several, the request must name one of them.
	 * Only an admission without tickets (no ticket they hold or bought
	 * there still admits anyone) keeps added activities at participant
	 * scope (null): a participant whose tickets were given away, or are
	 * not confirmed yet, has nothing to add them to.
	 *
	 * @param int      $event_date_id  Event date ID.
	 * @param int      $participant_id Participant ID.
	 * @param int|null $ticket_id      Ticket ID the request named, if any.
	 * @return object|null|\WP_Error Ticket row, null for participant scope, or an error.
	 */
	public static function resolve_addon_target( $event_date_id, $participant_id, $ticket_id ) {
		$tickets = self::addon_tickets( $event_date_id, $participant_id );

		if ( $ticket_id ) {
			foreach ( $tickets as $ticket ) {
				if ( (int) $ticket->id === (int) $ticket_id ) {
					return $ticket;
				}
			}

			return new \WP_Error(
				'invalid_ticket',
				__( 'That ticket cannot receive activities.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		if ( count( $tickets ) > 1 ) {
			return new \WP_Error(
				'ticket_required',
				__( 'Choose which ticket to add the activities to.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		if ( $tickets ) {
			return $tickets[0];
		}

		if ( self::backs_admission( $event_date_id, $participant_id ) ) {
			return new \WP_Error(
				'no_ticket',
				__( 'You no longer hold a ticket that can receive activities.', 'fair-audience' ),
				array( 'status' => 409 )
			);
		}

		return null;
	}

	/**
	 * A short label naming one of a participant's tickets.
	 *
	 * @param object $ticket   Ticket row.
	 * @param int    $position 1-based position among the participant's tickets.
	 * @return string
	 */
	public static function ticket_label( $ticket, $position ) {
		$type_name = '';
		if ( ! empty( $ticket->ticket_type_id ) && class_exists( \FairEvents\Models\TicketType::class ) ) {
			$ticket_type = \FairEvents\Models\TicketType::get_by_id( (int) $ticket->ticket_type_id );
			$type_name   = $ticket_type ? (string) $ticket_type->name : '';
		}

		$reference = strtoupper( substr( (string) $ticket->reference, 0, 8 ) );

		return '' !== $type_name
			? sprintf(
				/* translators: 1: ticket number among the participant's tickets, 2: ticket type name, 3: short ticket reference */
				__( 'Ticket %1$d — %2$s (%3$s)', 'fair-audience' ),
				$position,
				$type_name,
				$reference
			)
			: sprintf(
				/* translators: 1: ticket number among the participant's tickets, 2: short ticket reference */
				__( 'Ticket %1$d (%2$s)', 'fair-audience' ),
				$position,
				$reference
			);
	}
}
