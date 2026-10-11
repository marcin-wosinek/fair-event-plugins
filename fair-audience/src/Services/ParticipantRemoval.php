<?php
/**
 * Removing a participant from one event date.
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairAudience\Database\EventParticipantRepository;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Removes a participant's relationship with one event date, once nothing
 * else on that date depends on it.
 *
 * Only the relationship and the activities recorded on it are removed. The
 * participant's profile, their other dates, and every ticket, registration,
 * purchase and payment stay as they are, so a relationship that tickets, a
 * registration or a payment in progress still rest on is refused: removing
 * it would hide them from the audience. The organizer resolves those first,
 * with the ticket actions or on the List tab.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class ParticipantRemoval {

	/**
	 * Event participant repository.
	 *
	 * @var EventParticipantRepository
	 */
	private $event_participant_repo;

	/**
	 * Constructor.
	 *
	 * @param EventParticipantRepository|null $event_participant_repo Repository; a new one when omitted.
	 */
	public function __construct( $event_participant_repo = null ) {
		$this->event_participant_repo = $event_participant_repo ? $event_participant_repo : new EventParticipantRepository();
	}

	/**
	 * Whether fair-events' tickets and registrations can be read, so a
	 * removal can be checked against them.
	 *
	 * @return bool
	 */
	public static function available() {
		return TicketActivities::available()
			&& class_exists( \FairEvents\Models\EventSignup::class )
			&& method_exists( \FairEvents\Models\EventTicket::class, 'table' );
	}

	/**
	 * What stops each relationship on an event date from being removed.
	 *
	 * @param int                                     $event_date_id      Event date ID.
	 * @param \FairAudience\Models\EventParticipant[] $event_participants Relationships; only those on the event date are described.
	 * @return array<int, array[]> Blockers (code, message) keyed by relationship ID; an empty list when the relationship can be removed.
	 */
	public function blockers_for_event_date( $event_date_id, array $event_participants ) {
		$event_date_id = (int) $event_date_id;
		$on_this_date  = array();
		foreach ( $event_participants as $event_participant ) {
			if ( (int) $event_participant->event_date_id === $event_date_id ) {
				$on_this_date[] = $event_participant;
			}
		}
		if ( ! $on_this_date ) {
			return array();
		}

		$records = $this->related_records( $event_date_id, $on_this_date, false );

		$blockers = array();
		foreach ( $on_this_date as $event_participant ) {
			$blockers[ (int) $event_participant->id ] = self::describe_blockers(
				$event_participant,
				null === $records ? null : ( $records[ (int) $event_participant->participant_id ] ?? array() )
			);
		}

		return $blockers;
	}

	/**
	 * Remove a participant from an event date. The relationship is locked,
	 * checked again against the tickets, registrations and payments there,
	 * and removed with the activities recorded on it in one transaction:
	 * a refusal or a failed write leaves everything as it was.
	 *
	 * @param int $event_date_id  Event date ID.
	 * @param int $participant_id Participant ID.
	 * @return true|WP_Error A 404 without a relationship, a 409 naming the blockers, or a 500.
	 * @throws \Throwable Re-thrown after rolling back.
	 */
	public function remove( $event_date_id, $participant_id ) {
		global $wpdb;

		$wpdb->query( 'START TRANSACTION' );

		try {
			$result = $this->remove_in_transaction( (int) $event_date_id, (int) $participant_id );
		} catch ( \Throwable $e ) {
			$wpdb->query( 'ROLLBACK' );
			throw $e;
		}

		if ( is_wp_error( $result ) ) {
			$wpdb->query( 'ROLLBACK' );
		} else {
			$wpdb->query( 'COMMIT' );
		}

		return $result;
	}

	/**
	 * The checks and writes of remove(), run inside its transaction.
	 *
	 * @param int $event_date_id  Event date ID.
	 * @param int $participant_id Participant ID.
	 * @return true|WP_Error
	 */
	private function remove_in_transaction( $event_date_id, $participant_id ) {
		global $wpdb;

		$failed = new WP_Error(
			'removal_failed',
			__( 'The participant could not be removed. Nothing was changed; try again.', 'fair-audience' ),
			array( 'status' => 500 )
		);

		// Locked first: whoever gives this participant a ticket on the date
		// locks the same row, so they either wait for this removal or are
		// seen by the checks below.
		$relationship = $this->event_participant_repo->get_for_update( $event_date_id, $participant_id );
		if ( false === $relationship ) {
			return $failed;
		}
		if ( ! $relationship ) {
			return new WP_Error(
				'not_found',
				__( 'This participant is not in the audience of this event date.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$records = $this->related_records( $event_date_id, array( $relationship ), true );
		if ( false === $records ) {
			return $failed;
		}

		$blockers = self::describe_blockers( $relationship, null === $records ? null : ( $records[ $participant_id ] ?? array() ) );
		if ( $blockers ) {
			return new WP_Error(
				'removal_blocked',
				implode( ' ', wp_list_pluck( $blockers, 'message' ) ),
				array(
					'status'   => 409,
					'blockers' => $blockers,
				)
			);
		}

		if ( ! $this->event_participant_repo->delete_with_activities( $relationship ) || $wpdb->last_error ) {
			return $failed;
		}

		/**
		 * Fires once a participant's relationship with an event date was
		 * removed, inside the removal's transaction: a listener removing
		 * records of its own that belong to the relationship does so
		 * atomically, and an exception rolls the whole removal back.
		 *
		 * @param \FairAudience\Models\EventParticipant $relationship The removed relationship.
		 */
		do_action( 'fair_audience_event_participant_removed', $relationship );

		return true;
	}

	/**
	 * Count, per participant, the records on an event date that rest on
	 * their relationship there: tickets they hold or bought, registrations
	 * in their name and payments in progress.
	 *
	 * @param int                                     $event_date_id      Event date ID.
	 * @param \FairAudience\Models\EventParticipant[] $event_participants Relationships on the event date.
	 * @param bool                                    $lock               Read under locks held until the surrounding transaction ends, so nothing counted here changes, and nothing is added, before the removal is written.
	 * @return array<int, array<string, int>>|null|false Counts keyed by participant ID, null when fair-events cannot be read, false when a read failed.
	 */
	private function related_records( $event_date_id, array $event_participants, $lock ) {
		global $wpdb;

		if ( ! self::available() ) {
			return null;
		}

		$records          = array();
		$participant_ids  = array();
		$relationship_ids = array();
		foreach ( $event_participants as $event_participant ) {
			$participant_ids[]                                = (int) $event_participant->participant_id;
			$relationship_ids[ (int) $event_participant->id ] = (int) $event_participant->participant_id;
		}

		$placeholders = implode( ', ', array_fill( 0, count( $participant_ids ), '%d' ) );
		$lock_sql     = $lock ? ' FOR UPDATE' : '';
		$count        = static function ( $participant_id, $key ) use ( &$records ) {
			$records[ $participant_id ][ $key ] = ( $records[ $participant_id ][ $key ] ?? 0 ) + 1;
		};

		// Tickets the audience still lists: active ones, and cancelled ones
		// until an administrator deletes them. Failed, expired and refunded
		// tickets are kept with their purchase and are not listed.
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- placeholder lists built above.
		$tickets = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT holder_participant_id, purchaser_participant_id, status FROM %i
				 WHERE event_date_id = %d AND deleted_at IS NULL AND status NOT IN ( 'failed', 'expired', 'refunded' )
				 AND ( holder_participant_id IN ( $placeholders ) OR purchaser_participant_id IN ( $placeholders ) )" . $lock_sql,
				array_merge( array( \FairEvents\Models\EventTicket::table(), $event_date_id ), $participant_ids, $participant_ids )
			)
		);
		if ( $wpdb->last_error ) {
			return false;
		}

		// Registrations that still stand: confirmed, or awaiting a payment
		// whose hold runs. A failed or lapsed purchase binds nothing.
		$signups = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT participant_id, status FROM %i
				 WHERE event_date_id = %d AND participant_id IN ( $placeholders )
				 AND ( status = 'confirmed' OR ( status = 'pending_payment' AND payment_expires_at > %s ) )" . $lock_sql,
				array_merge( array( $wpdb->prefix . 'fair_events_signups', $event_date_id ), $participant_ids, array( gmdate( 'Y-m-d H:i:s' ) ) )
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
		if ( $wpdb->last_error ) {
			return false;
		}

		foreach ( $tickets as $ticket ) {
			$holder_id    = (int) $ticket->holder_participant_id;
			$purchaser_id = (int) $ticket->purchaser_participant_id;
			$cancelled    = 'cancelled' === $ticket->status;

			if ( $holder_id && in_array( $holder_id, $participant_ids, true ) ) {
				// A ticket nobody was given yet is its purchaser's own.
				$own = ! $purchaser_id || $purchaser_id === $holder_id;
				$count( $holder_id, ( $cancelled ? 'cancelled_' : 'held_' ) . ( $own ? 'own' : 'given' ) );
			}
			if ( ! $cancelled && $purchaser_id && $purchaser_id !== $holder_id && in_array( $purchaser_id, $participant_ids, true ) ) {
				$count( $purchaser_id, 'given_away' );
			}
		}

		foreach ( $signups as $signup ) {
			$count( (int) $signup->participant_id, 'confirmed' === $signup->status ? 'registrations' : 'payments_in_progress' );
		}

		// Activities held for a payment made through the relationship itself.
		foreach ( $this->event_participant_repo->get_participant_scope_option_rows( array_keys( $relationship_ids ) ) as $row ) {
			if ( 'pending_payment' === $row->status && ( empty( $row->expires_at ) || strtotime( $row->expires_at . ' UTC' ) > time() ) ) {
				$count( $relationship_ids[ (int) $row->event_participant_id ], 'payments_in_progress' );
			}
		}

		return $records;
	}

	/**
	 * Say what stops a relationship from being removed, and what the
	 * organizer does about each.
	 *
	 * @param \FairAudience\Models\EventParticipant $event_participant Relationship.
	 * @param array<string, int>|null               $records           Its participant's related_records() counts, or null when fair-events cannot be read.
	 * @return array[] Blockers, each with a code and a message; empty when the relationship can be removed.
	 */
	private static function describe_blockers( $event_participant, $records ) {
		if ( null === $records ) {
			// Without the tickets and registrations there is no telling
			// what would be left behind.
			return array(
				array(
					'code'    => 'fair_events_unavailable',
					'message' => __( 'Tickets and registrations for this date cannot be checked. Update Fair Events, then try again.', 'fair-audience' ),
				),
			);
		}

		$blockers = array();

		$awaits_payment = 'pending_payment' === $event_participant->label
			&& ! empty( $event_participant->payment_expires_at )
			&& strtotime( $event_participant->payment_expires_at . ' UTC' ) > time();
		if ( $awaits_payment || ! empty( $records['payments_in_progress'] ) ) {
			$blockers[] = array(
				'code'    => 'payment_in_progress',
				'message' => __( 'A payment by this participant for this date is in progress. Wait until it is completed or runs out, then try again.', 'fair-audience' ),
			);
		}

		// Deleting a registration deletes its tickets with it, so tickets
		// from the participant's own purchases are named only without one.
		$registrations = $records['registrations'] ?? 0;
		if ( $registrations ) {
			$blockers[] = array(
				'code'    => 'registration',
				'message' => sprintf(
					/* translators: %d: number of registrations */
					_n(
						'This participant has %d registration for this date. Delete it on the List tab first; its tickets are deleted with it.',
						'This participant has %d registrations for this date. Delete them on the List tab first; their tickets are deleted with them.',
						$registrations,
						'fair-audience'
					),
					$registrations
				),
			);
		}

		$held = ( $records['held_given'] ?? 0 ) + ( $registrations ? 0 : ( $records['held_own'] ?? 0 ) );
		if ( $held ) {
			$blockers[] = array(
				'code'    => 'tickets',
				'message' => sprintf(
					/* translators: %d: number of tickets */
					_n(
						'This participant holds %d ticket for this date. Assign it to someone else, or cancel and then delete it, with the ticket’s actions.',
						'This participant holds %d tickets for this date. Assign them to someone else, or cancel and then delete them, with each ticket’s actions.',
						$held,
						'fair-audience'
					),
					$held
				),
			);
		}

		$cancelled = ( $records['cancelled_given'] ?? 0 ) + ( $registrations ? 0 : ( $records['cancelled_own'] ?? 0 ) );
		if ( $cancelled ) {
			$blockers[] = array(
				'code'    => 'cancelled_tickets',
				'message' => sprintf(
					/* translators: %d: number of tickets */
					_n(
						'%d cancelled ticket is still listed under this participant. Delete it with its “Delete ticket” action.',
						'%d cancelled tickets are still listed under this participant. Delete them with their “Delete ticket” action.',
						$cancelled,
						'fair-audience'
					),
					$cancelled
				),
			);
		}

		$given_away = $registrations ? 0 : ( $records['given_away'] ?? 0 );
		if ( $given_away ) {
			$blockers[] = array(
				'code'    => 'tickets_given_away',
				'message' => sprintf(
					/* translators: %d: number of tickets */
					_n(
						'This participant bought %d ticket for this date that someone else holds. Cancel and then delete it with the ticket’s actions.',
						'This participant bought %d tickets for this date that other people hold. Cancel and then delete them with each ticket’s actions.',
						$given_away,
						'fair-audience'
					),
					$given_away
				),
			);
		}

		return $blockers;
	}
}
