<?php
/**
 * Places behind advertised ticket offers
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\EventDates;

defined( 'WPINC' ) || die;

/**
 * Answers whether one ticket of a type can still be bought on an
 * occurrence, for structured data. It asks what public signup asks of
 * TicketCapacity (see TicketCapacity::places_needed()): a place on the
 * occurrence, or on every upcoming active occurrence a whole-series ticket
 * covers, a place of the ticket type, and a place in each selected
 * extension on every covered occurrence.
 *
 * Places are only read, never locked: checkout still validates and
 * reserves under its own lock. Each count is made once per instance, so
 * several ticket types sharing an occurrence or an extension do not repeat
 * it.
 */
class OfferCapacity {

	/**
	 * Occurrence the offers are advertised for.
	 *
	 * @var int
	 */
	private $event_date_id;

	/**
	 * Occurrences a whole-series ticket bought now covers, once read.
	 *
	 * @var int[]|null
	 */
	private $whole_series_ids = null;

	/**
	 * Whether each extension is full, by option ID then occurrence ID.
	 *
	 * @var array<int, array<int, bool>>
	 */
	private $option_full = array();

	/**
	 * Start a read-only capacity view of one occurrence.
	 *
	 * @param int $event_date_id Occurrence the offers are advertised for.
	 */
	public function __construct( int $event_date_id ) {
		$this->event_date_id = $event_date_id;
	}

	/**
	 * Types that cannot sell one more ticket because the event date (any
	 * covered date for a whole-series type) or the type itself has no place
	 * left. A date or type without a limit is never the reason.
	 *
	 * @param object[] $ticket_types Ticket types to check (id, capacity, recurrence_scope).
	 * @return int[] Sold-out ticket type IDs.
	 */
	public function sold_out_type_ids( array $ticket_types ) {
		if ( empty( $ticket_types ) ) {
			return array();
		}

		$covered_by_type = array();
		foreach ( $ticket_types as $ticket_type ) {
			$covered_by_type[ (int) $ticket_type->id ] = $this->covered_ids( $ticket_type );
		}

		// Every covered date is loaded and counted once for all types.
		$remaining = TicketCapacity::remaining_for_event_dates(
			EventDates::get_by_ids( array_merge( array(), ...array_values( $covered_by_type ) ) )
		);

		$sold_out = array();
		foreach ( $ticket_types as $ticket_type ) {
			$type_id = (int) $ticket_type->id;

			$date_full = false;
			foreach ( $covered_by_type[ $type_id ] as $covered_id ) {
				if ( isset( $remaining[ $covered_id ] ) && $remaining[ $covered_id ] < 1 ) {
					$date_full = true;
					break;
				}
			}

			$type_capacity = $ticket_type->capacity ?? null;
			$type_full     = null !== $type_capacity
				&& (int) $type_capacity - TicketCapacity::count_ticket_type( $type_id ) < 1;

			if ( $date_full || $type_full ) {
				$sold_out[] = $type_id;
			}
		}

		return $sold_out;
	}

	/**
	 * Prices of the configured extensions a ticket of this type could still
	 * select: those with a place on every occurrence the ticket covers.
	 *
	 * @param array[] $configured  Configured extensions, as EventSchema::configured_extension_options() returns them.
	 * @param object  $ticket_type Ticket type (recurrence_scope).
	 * @return float[] Extension prices with places left.
	 */
	public function available_extension_prices( array $configured, $ticket_type ) {
		$covered = $this->covered_ids( $ticket_type );

		$prices = array();
		foreach ( $configured as $row ) {
			if ( ! $this->option_full_on_any( $row['option'], $covered ) ) {
				$prices[] = $row['price'];
			}
		}

		return $prices;
	}

	/**
	 * Whether an extension has no place left on any of the given occurrences.
	 *
	 * @param object $option  Extension option (id, capacity).
	 * @param int[]  $covered Occurrence IDs.
	 * @return bool
	 */
	private function option_full_on_any( $option, array $covered ) {
		if ( null === $option->capacity ) {
			return false;
		}

		$option_id = (int) $option->id;
		foreach ( $covered as $covered_id ) {
			if ( ! isset( $this->option_full[ $option_id ][ $covered_id ] ) ) {
				$this->option_full[ $option_id ][ $covered_id ] = ActivitySelection::is_full( $option, $covered_id );
			}

			if ( $this->option_full[ $option_id ][ $covered_id ] ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Occurrences one ticket of this type takes a place on.
	 *
	 * @param object $ticket_type Ticket type (recurrence_scope).
	 * @return int[]
	 */
	private function covered_ids( $ticket_type ) {
		if ( 'whole_series' !== ( $ticket_type->recurrence_scope ?? '' ) ) {
			return array( $this->event_date_id );
		}

		if ( null === $this->whole_series_ids ) {
			$this->whole_series_ids = TicketCapacity::get_whole_series_occurrence_ids( $this->event_date_id );
		}

		return $this->whole_series_ids;
	}
}
