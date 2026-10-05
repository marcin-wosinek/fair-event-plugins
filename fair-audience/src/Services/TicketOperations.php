<?php
/**
 * Ticket Operations
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairAudience\Database\EventParticipantRepository;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * An administrator's operations on one individual ticket: moving it to
 * another date of its series, cancelling it, and deleting it once cancelled.
 *
 * Each changes only the selected ticket. Its signup, purchaser, transaction
 * and amounts, and the purchase's other tickets, stay as they are: none of
 * these operations refunds anything or removes a participant. Afterwards the
 * participants' relationships are brought in line with the tickets left on
 * each date, keeping every participant listed.
 *
 * Every check is repeated on the locked ticket row inside the transaction
 * that writes, so a refused or failed operation changes nothing.
 */
class TicketOperations {

	/**
	 * Database version of fair-events that can move, cancel and mark
	 * individual tickets as deleted.
	 */
	const REQUIRED_EVENTS_DB_VERSION = '3.42.0';

	/**
	 * Event-participant repository.
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
	 * Whether fair-events supports these operations.
	 *
	 * @return bool
	 */
	public static function available() {
		return TicketActivities::available()
			&& method_exists( \FairEvents\Models\EventTicket::class, 'mark_deleted' )
			&& version_compare( \FairEvents\Database\Schema::get_db_version(), self::REQUIRED_EVENTS_DB_VERSION, '>=' );
	}

	/**
	 * Whether a ticket can be moved at all: it admits someone, and is not a
	 * whole-series pass, which covers every date.
	 *
	 * @param object $ticket Ticket row.
	 * @return bool
	 */
	public static function is_movable( $ticket ) {
		return null === self::move_refusal( $ticket );
	}

	/**
	 * Why a ticket cannot be moved, if it cannot. Confirmed tickets and
	 * tickets awaiting payment within their hold can move, checked in or
	 * not; the check-in stays on the ticket.
	 *
	 * @param object $ticket Ticket row.
	 * @return WP_Error|null
	 */
	public static function move_refusal( $ticket ) {
		$refusal = self::inactive_refusal( $ticket );
		if ( $refusal ) {
			return $refusal;
		}

		if ( 'confirmed' !== (string) $ticket->status ) {
			$signup = \FairEvents\Models\EventSignup::get_by_id( (int) $ticket->signup_id );
			if ( ! $signup || ! \FairEvents\Services\TicketCapacity::signup_holds_places( $signup ) ) {
				return new WP_Error(
					'ticket_payment_expired',
					__( 'The payment for this ticket was not completed in time, so it cannot be moved.', 'fair-audience' ),
					array( 'status' => 409 )
				);
			}
		}

		$ticket_type = $ticket->ticket_type_id ? \FairEvents\Models\TicketType::get_by_id( (int) $ticket->ticket_type_id ) : null;
		if ( $ticket_type && $ticket_type->is_whole_series() ) {
			return new WP_Error(
				'ticket_not_movable',
				__( 'A whole-series ticket covers every date and cannot be moved.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		return null;
	}

	/**
	 * The dates a ticket can move to: the other active dates of its
	 * recurring event.
	 *
	 * @param object $ticket Ticket row.
	 * @return object[] Event dates keyed by ID.
	 */
	public static function move_targets( $ticket ) {
		$event_date = \FairEvents\Models\EventDates::get_by_id( (int) $ticket->event_date_id );
		if ( ! $event_date ) {
			return array();
		}

		$master_id = ( 'generated' === $event_date->occurrence_type && $event_date->master_id )
			? (int) $event_date->master_id
			: (int) $event_date->id;

		$targets = array();
		foreach ( \FairEvents\Models\EventDates::get_all_by_master_id( $master_id ) as $sibling ) {
			if ( (int) $sibling->id !== (int) $ticket->event_date_id && 'active' === $sibling->status ) {
				$targets[ (int) $sibling->id ] = $sibling;
			}
		}

		return $targets;
	}

	/**
	 * Move one ticket to another date of its recurring event.
	 *
	 * The target date needs one place, and each activity the ticket holds
	 * one place there. Every limit the move would go past is reported at
	 * once with a 409 carrying the projections, unless a reason is given:
	 * then the move is saved, flagged over capacity and recorded in the
	 * override audit. The ticket's holder is admitted on the target date,
	 * and its purchaser's relationship on the source date follows the
	 * tickets left there.
	 *
	 * @param object      $ticket               Ticket row.
	 * @param int         $target_event_date_id Target event date ID.
	 * @param string|null $reason               Override reason, or null when none was given.
	 * @return true|WP_Error
	 */
	public function move( $ticket, $target_event_date_id, $reason ) {
		$ticket_id            = (int) $ticket->id;
		$source_event_date_id = (int) $ticket->event_date_id;
		$target_event_date_id = (int) $target_event_date_id;

		$refusal = self::move_refusal( $ticket );
		if ( $refusal ) {
			return $refusal;
		}

		if ( ! isset( self::move_targets( $ticket )[ $target_event_date_id ] ) ) {
			return new WP_Error(
				'invalid_target',
				__( 'The target date is not another active date of this recurring event.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		$activity_demand = array(
			'event_date_id'  => $target_event_date_id,
			'ticket_type_id' => 0,
			'quantity'       => 0,
			'option_ids'     => \FairEvents\Models\EventTicketActivity::get_active_option_ids( array( $ticket_id ) ),
		);
		$repository      = $this->event_participant_repo;

		// The ticket keeps its type, so only the target date and the
		// activities it brings along need places.
		return \FairEvents\Services\TicketCapacity::with_capacity_lock(
			array( array_merge( $activity_demand, array( 'quantity' => 1 ) ) ),
			static function () use ( $ticket_id, $source_event_date_id, $target_event_date_id, $activity_demand, $reason, $repository ) {
				$failed = new WP_Error(
					'move_failed',
					__( 'Failed to move the ticket.', 'fair-audience' ),
					array( 'status' => 500 )
				);

				$locked = self::lock_ticket( $ticket_id, $source_event_date_id );
				if ( is_wp_error( $locked ) ) {
					return $locked;
				}

				$refusal = self::move_refusal( $locked );
				if ( $refusal ) {
					return $refusal;
				}

				$projection = \FairEvents\Services\TicketCapacity::projection( 'event_date', $target_event_date_id, 1 );
				if ( ! $projection ) {
					return $failed;
				}

				$exceeding = \FairEvents\Services\TicketCapacity::projection_exceeds( $projection ) ? array( $projection ) : array();
				foreach ( \FairEvents\Services\TicketCapacity::activity_projections( array( $activity_demand ) ) as $activity_projection ) {
					if ( \FairEvents\Services\TicketCapacity::projection_exceeds( $activity_projection ) ) {
						$exceeding[] = $activity_projection;
					}
				}

				if ( $exceeding && null === $reason ) {
					return new WP_Error(
						'capacity_exceeded',
						sprintf(
							/* translators: 1: event date or activity name, 2: places taken after the move, 3: capacity */
							_n(
								'%1$s would have %2$d of %3$d place taken.',
								'%1$s would have %2$d of %3$d places taken.',
								(int) $exceeding[0]['capacity'],
								'fair-audience'
							),
							$exceeding[0]['label'],
							$exceeding[0]['after'],
							$exceeding[0]['capacity']
						),
						array(
							'status'      => 409,
							'projection'  => $exceeding[0],
							'projections' => $exceeding,
						)
					);
				}

				if ( ! \FairEvents\Models\EventTicket::set_event_date( $ticket_id, $target_event_date_id ) ) {
					return $failed;
				}

				foreach ( $exceeding as $exceeded ) {
					$is_activity = 'ticket_option' === $exceeded['scope'];
					if ( $is_activity ) {
						\FairEvents\Models\EventTicketActivity::mark_over_capacity( $ticket_id, array( (int) $exceeded['id'] ) );
					}
					\FairEvents\Models\EventSignup::mark_over_capacity( (int) $locked->signup_id );

					$recorded = \FairEvents\Models\EventCapacityOverride::create(
						array(
							'signup_id'           => (int) $locked->signup_id,
							'action'              => 'move',
							'from_event_date_id'  => $source_event_date_id,
							'to_event_date_id'    => $target_event_date_id,
							'from_ticket_type_id' => (int) $locked->ticket_type_id,
							'to_ticket_type_id'   => (int) $locked->ticket_type_id,
							'ticket_id'           => $ticket_id,
							'ticket_option_id'    => $is_activity ? (int) $exceeded['id'] : 0,
							'ticket_option_name'  => $is_activity ? $exceeded['label'] : '',
							'ticket_count'        => 1,
							'taken'               => (int) $exceeded['taken'],
							'capacity'            => (int) $exceeded['capacity'],
							'reason'              => $reason,
							'user_id'             => get_current_user_id(),
						)
					);
					if ( ! $recorded ) {
						return $failed;
					}
				}

				$purchaser_id = self::purchaser_id( $locked );
				$holder_id    = (int) $locked->holder_participant_id;
				if ( $holder_id
					&& ! $repository->ensure_ticket_admission(
						$target_event_date_id,
						$holder_id,
						$holder_id === $purchaser_id && 'confirmed' === (string) $locked->status
					)
				) {
					return $failed;
				}

				if ( $purchaser_id && ! $repository->reconcile_ticket_admission( $source_event_date_id, $purchaser_id ) ) {
					return $failed;
				}

				return true;
			}
		);
	}

	/**
	 * Cancel one ticket. It stops admitting its holder and releases its
	 * places and activities. Nothing is refunded and the purchase keeps its
	 * amounts: a refund, when one is due, is made separately.
	 *
	 * @param object $ticket Ticket row.
	 * @return true|WP_Error
	 */
	public function cancel( $ticket ) {
		$repository = $this->event_participant_repo;

		return self::in_transaction(
			static function () use ( $ticket, $repository ) {
				$failed = new WP_Error(
					'cancel_failed',
					__( 'Failed to cancel the ticket.', 'fair-audience' ),
					array( 'status' => 500 )
				);

				$locked = self::lock_ticket( (int) $ticket->id, (int) $ticket->event_date_id );
				if ( is_wp_error( $locked ) ) {
					return $locked;
				}

				$refusal = self::inactive_refusal( $locked );
				if ( $refusal ) {
					return $refusal;
				}

				if ( ! \FairEvents\Models\EventTicket::cancel( (int) $locked->id ) ) {
					return $failed;
				}

				$purchaser_id = self::purchaser_id( $locked );
				if ( $purchaser_id && ! $repository->reconcile_ticket_admission( (int) $locked->event_date_id, $purchaser_id ) ) {
					return $failed;
				}

				return true;
			}
		);
	}

	/**
	 * Delete one cancelled ticket: it is hidden for good from the audience,
	 * its searches and exports, while its record stays with the purchase.
	 * A ticket has to be cancelled first, so deleting never ends an
	 * admission by itself.
	 *
	 * @param object $ticket Ticket row.
	 * @return true|WP_Error
	 */
	public function delete( $ticket ) {
		return self::in_transaction(
			static function () use ( $ticket ) {
				$locked = self::lock_ticket( (int) $ticket->id, (int) $ticket->event_date_id );
				if ( is_wp_error( $locked ) ) {
					return $locked;
				}

				if ( 'cancelled' !== (string) $locked->status ) {
					return new WP_Error(
						'ticket_not_cancelled',
						__( 'Cancel this ticket before deleting it.', 'fair-audience' ),
						array( 'status' => 409 )
					);
				}

				if ( ! \FairEvents\Models\EventTicket::mark_deleted( (int) $locked->id ) ) {
					return new WP_Error(
						'delete_failed',
						__( 'Failed to delete the ticket.', 'fair-audience' ),
						array( 'status' => 500 )
					);
				}

				return true;
			}
		);
	}

	/**
	 * After a purchase is paid, bring relationships in line with tickets an
	 * administrator moved or cancelled while it was awaiting payment: the
	 * holder of a ticket now on another date is admitted there, and a
	 * purchaser left without an active ticket on the purchase's date is no
	 * longer signed up for it.
	 *
	 * @param object $signup Confirmed signup row.
	 * @return void
	 */
	public function follow_signup_confirmation( $signup ) {
		if ( ! self::available() ) {
			return;
		}

		$purchaser_id = (int) ( $signup->participant_id ?? 0 );
		foreach ( \FairEvents\Models\EventTicket::get_by_signup_id( (int) $signup->id ) as $ticket ) {
			$holder_id = (int) $ticket->holder_participant_id;
			if ( $holder_id
				&& 'confirmed' === (string) $ticket->status
				&& (int) $ticket->event_date_id !== (int) $signup->event_date_id
			) {
				$this->event_participant_repo->ensure_ticket_admission( (int) $ticket->event_date_id, $holder_id, self::purchaser_id( $ticket ) === $holder_id );
			}
		}

		if ( $purchaser_id ) {
			$this->event_participant_repo->reconcile_ticket_admission( (int) $signup->event_date_id, $purchaser_id );
		}
	}

	/**
	 * Why a ticket that no longer admits anyone cannot be changed.
	 *
	 * @param object $ticket Ticket row.
	 * @return WP_Error|null
	 */
	private static function inactive_refusal( $ticket ) {
		if ( in_array( (string) $ticket->status, \FairEvents\Models\EventTicket::INACTIVE_STATUSES, true ) ) {
			return new WP_Error(
				'ticket_inactive',
				__( 'This ticket is no longer active.', 'fair-audience' ),
				array( 'status' => 409 )
			);
		}

		return null;
	}

	/**
	 * Read a ticket under a row lock and make sure it is still the one the
	 * request named: on the same event date and not deleted.
	 *
	 * @param int $ticket_id     Ticket ID.
	 * @param int $event_date_id Event date the ticket was on when the request was checked.
	 * @return object|WP_Error
	 */
	private static function lock_ticket( $ticket_id, $event_date_id ) {
		$locked = \FairEvents\Models\EventTicket::get_for_update( (int) $ticket_id );
		if ( ! $locked
			|| (int) $locked->event_date_id !== (int) $event_date_id
			|| \FairEvents\Models\EventTicket::is_deleted( $locked )
		) {
			return new WP_Error(
				'ticket_not_found',
				__( 'Ticket not found for this event date.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		return $locked;
	}

	/**
	 * The participant who bought a ticket: its purchaser link, else its
	 * signup's participant.
	 *
	 * @param object $ticket Ticket row.
	 * @return int 0 when no participant is linked.
	 */
	private static function purchaser_id( $ticket ) {
		if ( ! empty( $ticket->purchaser_participant_id ) ) {
			return (int) $ticket->purchaser_participant_id;
		}

		$signup = \FairEvents\Models\EventSignup::get_by_id( (int) $ticket->signup_id );

		return $signup ? (int) ( $signup->participant_id ?? 0 ) : 0;
	}

	/**
	 * Run writes in one transaction. A WP_Error result or an exception rolls
	 * back; anything else commits.
	 *
	 * @param callable $callback The writes.
	 * @return mixed The callback's result.
	 * @throws \Throwable Re-thrown after rolling back.
	 */
	private static function in_transaction( callable $callback ) {
		global $wpdb;

		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query( 'START TRANSACTION' );

		try {
			$result = $callback();
		} catch ( \Throwable $e ) {
			$wpdb->query( 'ROLLBACK' );
			throw $e;
		}

		if ( is_wp_error( $result ) ) {
			$wpdb->query( 'ROLLBACK' );
		} else {
			$wpdb->query( 'COMMIT' );
		}
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

		return $result;
	}
}
