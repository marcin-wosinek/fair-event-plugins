<?php
/**
 * What a paid transaction bought, for ticket sale alerts.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

use FairEvents\Helpers\DateRangeFormatter;
use FairEvents\Models\EventDates;
use FairEvents\Models\EventSignup;
use FairEvents\Models\EventTicket;
use FairEvents\Models\TicketType;
use FairEvents\Services\PaymentAttributionDatabase;
use FairEvents\Services\PurchaseLifecycle;

defined( 'WPINC' ) || die;

/**
 * Reads one paid transaction and the purchases its charge links name
 * (#2448): Connector keeps the charged total and currency, Fair Events the
 * purchases, their tickets and the event they belong to.
 */
class SaleAlertSource {

	/**
	 * The owning event of a stored date: a generated occurrence's series
	 * master, otherwise the date itself.
	 *
	 * @param int $event_date_id Stored event date ID.
	 * @return int 0 when the date doesn't exist.
	 */
	public function owner_of( $event_date_id ) {
		$date = EventDates::get_by_id( (int) $event_date_id );
		if ( ! $date ) {
			return 0;
		}
		return 'generated' === $date->occurrence_type && (int) $date->master_id ? (int) $date->master_id : (int) $date->id;
	}

	/**
	 * The organizer assignment stored on an owning event.
	 *
	 * @param int $owner_id Single event or series master date ID.
	 * @return string|null Organizer UUID, or null for the sitewide organizer.
	 */
	public function stored_organizer( $owner_id ) {
		return EventDates::get_organizer_id( (int) $owner_id );
	}

	/**
	 * A transaction's sale.
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return array|null `{ transaction, purchases, tickets, owner_ids, event }`;
	 *     null when Connector has no such transaction.
	 */
	public function load( $transaction_id ) {
		$transaction = self::transaction( (int) $transaction_id );
		if ( ! $transaction ) {
			return null;
		}

		$purchases  = array();
		$owner_ids  = array();
		$signup_ids = PurchaseLifecycle::linked_signup_ids( (int) $transaction_id );
		foreach ( $signup_ids as $signup_id ) {
			$signup = EventSignup::get_by_id( $signup_id );
			if ( ! $signup ) {
				continue;
			}
			$owner               = $this->owner_of( (int) $signup->event_date_id );
			$purchases[]         = array(
				'id'             => (int) $signup->id,
				'status'         => (string) $signup->status,
				'transaction_id' => (int) $signup->transaction_id,
				'event_date_id'  => (int) $signup->event_date_id,
				'owner_id'       => $owner,
			);
			$owner_ids[ $owner ] = $owner;
		}

		$owner_ids = array_values( $owner_ids );
		$event     = null;
		if ( 1 === count( $owner_ids ) && $owner_ids[0] ) {
			$master = EventDates::get_by_id( $owner_ids[0] );
			$event  = array(
				'id'           => $owner_ids[0],
				'title'        => $master ? (string) $master->get_display_title() : '',
				'organizer_id' => $this->stored_organizer( $owner_ids[0] ),
			);
		}

		$tickets = self::tickets( $signup_ids );

		return array(
			'transaction' => $transaction,
			'purchases'   => $purchases,
			'tickets'     => $tickets['types'],
			'dates'       => $tickets['dates'],
			'owner_ids'   => $owner_ids,
			'event'       => $event,
		);
	}

	/**
	 * The transaction as the alert needs it.
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return array|null
	 */
	private static function transaction( $transaction_id ) {
		if ( ! class_exists( \FairPaymentsConnector\Models\Transaction::class ) ) {
			return null;
		}
		$transaction = \FairPaymentsConnector\Models\Transaction::get_by_id( $transaction_id );
		if ( ! $transaction ) {
			return null;
		}
		$metadata = PaymentAttributionDatabase::decode_metadata( $transaction->metadata ?? null );

		return array(
			'id'       => (int) $transaction->id,
			'status'   => (string) $transaction->status,
			'amount'   => (float) $transaction->amount,
			'currency' => (string) $transaction->currency,
			'source'   => (string) ( $metadata['source'] ?? '' ),
		);
	}

	/**
	 * The admitting tickets of the purchases, counted by ticket type, and
	 * the dates they are for.
	 *
	 * A purchase whose units are missing counts its own quantity and type.
	 *
	 * @param int[] $signup_ids Signup IDs.
	 * @return array{types: array[], dates: string[]}
	 */
	private static function tickets( array $signup_ids ) {
		$units  = EventTicket::get_by_signup_ids( $signup_ids );
		$counts = array();
		$dates  = array();
		foreach ( $signup_ids as $signup_id ) {
			$signup = EventSignup::get_by_id( $signup_id );
			if ( ! $signup || 'confirmed' !== (string) $signup->status ) {
				continue;
			}
			$entries = array();
			if ( ! empty( $units[ $signup_id ] ) ) {
				foreach ( $units[ $signup_id ] as $unit ) {
					if ( in_array( (string) $unit->status, EventTicket::INACTIVE_STATUSES, true ) || EventTicket::is_deleted( $unit ) ) {
						continue;
					}
					$entries[] = array(
						'type'          => null !== $unit->ticket_type_id ? (int) $unit->ticket_type_id : (int) $signup->ticket_type_id,
						'event_date_id' => (int) $unit->event_date_id,
						'quantity'      => 1,
					);
				}
			} else {
				$entries[] = array(
					'type'          => (int) $signup->ticket_type_id,
					'event_date_id' => (int) $signup->event_date_id,
					'quantity'      => max( 1, (int) $signup->quantity ),
				);
			}

			foreach ( $entries as $entry ) {
				$counts[ $entry['type'] ]         = ( $counts[ $entry['type'] ] ?? 0 ) + $entry['quantity'];
				$dates[ $entry['event_date_id'] ] = true;
			}
		}

		$types = array();
		foreach ( $counts as $type_id => $quantity ) {
			$type    = $type_id ? TicketType::get_by_id( $type_id ) : null;
			$types[] = array(
				'ticket_type_id' => (int) $type_id,
				'name'           => $type ? (string) $type->name : '',
				'quantity'       => (int) $quantity,
			);
		}

		return array(
			'types' => $types,
			'dates' => self::date_labels( array_keys( $dates ) ),
		);
	}

	/**
	 * Date labels in date order.
	 *
	 * @param int[] $event_date_ids Stored event date IDs.
	 * @return string[]
	 */
	private static function date_labels( array $event_date_ids ) {
		$dated = array();
		foreach ( $event_date_ids as $event_date_id ) {
			$date = EventDates::get_by_id( (int) $event_date_id );
			if ( $date ) {
				$dated[] = array( (string) $date->start_date . ' ' . (string) $date->start_time, DateRangeFormatter::format_timing( $date->get_timing() ) );
			}
		}
		usort(
			$dated,
			static function ( $a, $b ) {
				return strcmp( $a[0], $b[0] );
			}
		);
		return array_column( $dated, 1 );
	}
}
