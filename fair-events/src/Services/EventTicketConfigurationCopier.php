<?php
/**
 * Event ticket configuration copier.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

use FairEvents\Models\EventDates;
use FairEvents\Models\EventDateSetting;
use FairEvents\Models\TicketPrice;
use FairEvents\Models\TicketSalePeriod;
use FairEvents\Models\TicketType;
use FairEvents\Models\TicketTypeGroupRestriction;

/**
 * Copies reusable ticket configuration between event dates.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EventTicketConfigurationCopier {

	/**
	 * Copy the complete reusable ticket configuration.
	 *
	 * @param int           $source_event_date_id      Source event date ID.
	 * @param int           $destination_event_date_id Destination event date ID.
	 * @param \DateInterval $date_shift                Site-local shift from source to destination.
	 * @return bool Whether the copy completed consistently.
	 * @throws \RuntimeException Internally when any related record cannot be copied.
	 */
	public function copy( $source_event_date_id, $destination_event_date_id, $date_shift ) {
		global $wpdb;

		$source_event_date = EventDates::get_by_id( $source_event_date_id );
		if ( ! $source_event_date ) {
			return false;
		}

		$wpdb->query( 'START TRANSACTION' );

		try {
			if ( ! EventDates::update_by_id( $destination_event_date_id, array( 'capacity' => $source_event_date->capacity ) ) ) {
				throw new \RuntimeException( 'Could not copy event capacity.' );
			}

			foreach ( EventDateSetting::get_all_for_event_date( $source_event_date_id ) as $key => $value ) {
				if ( ! EventDateSetting::set( $destination_event_date_id, $key, $value ) ) {
					throw new \RuntimeException( 'Could not copy ticket settings.' );
				}
			}

			$type_map        = $this->copy_ticket_types( $source_event_date_id, $destination_event_date_id, $date_shift );
			$sale_period_map = $this->copy_sale_periods( $source_event_date_id, $destination_event_date_id, $date_shift );
			$this->copy_prices( $source_event_date_id, $type_map, $sale_period_map );
			$this->copy_experimental_options( $source_event_date_id, $destination_event_date_id, $sale_period_map );

			$wpdb->query( 'COMMIT' );
			return true;
		} catch ( \Throwable $error ) {
			$wpdb->query( 'ROLLBACK' );
			return false;
		}
	}

	/**
	 * Copy ticket types and group restrictions.
	 *
	 * @param int           $source_id      Source event date ID.
	 * @param int           $destination_id Destination event date ID.
	 * @param \DateInterval $date_shift     Site-local date shift.
	 * @return array<int, int> Old-to-new ticket type ID map.
	 * @throws \RuntimeException When a ticket type cannot be copied.
	 */
	private function copy_ticket_types( $source_id, $destination_id, $date_shift ) {
		$map          = array();
		$restrictions = TicketTypeGroupRestriction::get_all_by_event_date_id( $source_id );

		foreach ( TicketType::get_all_by_event_date_id( $source_id ) as $type ) {
			$new_id = TicketType::create(
				$destination_id,
				$type->name,
				$type->capacity,
				$type->sort_order,
				$type->minimum_activities,
				$this->shift_datetime( $type->disable_at, $date_shift ),
				$type->recurrence_scope,
				$type->disabled,
				$type->minimum_instances,
				$type->activities_enabled,
				$type->maximum_activities
			);

			if ( ! $new_id ) {
				throw new \RuntimeException( 'Could not copy a ticket type.' );
			}

			$map[ $type->id ] = (int) $new_id;
			TicketTypeGroupRestriction::sync_for_ticket_type( (int) $new_id, $restrictions[ $type->id ] ?? array() );
		}

		return $map;
	}

	/**
	 * Copy ticket sale periods.
	 *
	 * @param int           $source_id      Source event date ID.
	 * @param int           $destination_id Destination event date ID.
	 * @param \DateInterval $date_shift     Site-local date shift.
	 * @return array<int, int> Old-to-new sale-period ID map.
	 * @throws \RuntimeException When a sale period cannot be copied.
	 */
	private function copy_sale_periods( $source_id, $destination_id, $date_shift ) {
		$map = array();
		foreach ( TicketSalePeriod::get_all_by_event_date_id( $source_id ) as $period ) {
			$new_id = TicketSalePeriod::create(
				$destination_id,
				$period->name,
				$this->shift_datetime( $period->sale_start, $date_shift ),
				$this->shift_datetime( $period->sale_end, $date_shift ),
				$period->sort_order
			);

			if ( ! $new_id ) {
				throw new \RuntimeException( 'Could not copy a ticket sale period.' );
			}
			$map[ $period->id ] = (int) $new_id;
		}

		return $map;
	}

	/**
	 * Copy ticket prices with remapped relationships.
	 *
	 * @param int             $source_id      Source event date ID.
	 * @param array<int, int> $type_map       Ticket type ID map.
	 * @param array<int, int> $period_map     Sale-period ID map.
	 * @return void
	 * @throws \RuntimeException When a ticket price cannot be copied or remapped.
	 */
	private function copy_prices( $source_id, $type_map, $period_map ) {
		foreach ( TicketPrice::get_all_by_event_date_id( $source_id ) as $price ) {
			if ( ! isset( $type_map[ $price->ticket_type_id ], $period_map[ $price->sale_period_id ] ) ) {
				throw new \RuntimeException( 'Could not remap a ticket price.' );
			}

			if ( ! TicketPrice::create( $type_map[ $price->ticket_type_id ], $period_map[ $price->sale_period_id ], $price->price, $price->capacity ) ) {
				throw new \RuntimeException( 'Could not copy a ticket price.' );
			}
		}
	}

	/**
	 * Copy optional ticket-option configuration when its models are available.
	 *
	 * @param int             $source_id      Source event date ID.
	 * @param int             $destination_id Destination event date ID.
	 * @param array<int, int> $period_map     Sale-period ID map.
	 * @return void
	 * @throws \RuntimeException When an option record cannot be copied or remapped.
	 */
	private function copy_experimental_options( $source_id, $destination_id, $period_map ) {
		$option_class       = \FairEventsExperimental\Models\TicketOption::class;
		$collaborator_class = \FairEventsExperimental\Models\TicketOptionCollaborator::class;
		$price_class        = \FairEventsExperimental\Models\TicketOptionPrice::class;

		if ( ! class_exists( $option_class ) ) {
			return;
		}

		$collaborators = class_exists( $collaborator_class ) ? $collaborator_class::get_all_by_event_date_id( $source_id ) : array();
		$option_prices = class_exists( $price_class ) ? $price_class::get_all_by_event_date_id( $source_id ) : array();
		$option_map    = array();

		foreach ( $option_class::get_all_by_event_date_id( $source_id ) as $option ) {
			$new_id = $option_class::create( $destination_id, $option->name, $option->price, $option->sort_order, $option->short_name, $option->discounted_price, $option->capacity, $option->derive_price_from_sale_period );
			if ( ! $new_id ) {
				throw new \RuntimeException( 'Could not copy a ticket option.' );
			}

			$option_map[ $option->id ] = (int) $new_id;
			if ( class_exists( $collaborator_class ) ) {
				$collaborator_class::sync_for_option( (int) $new_id, $collaborators[ $option->id ] ?? array() );
			}
		}

		if ( ! class_exists( $price_class ) ) {
			return;
		}

		foreach ( $option_prices as $price ) {
			if ( ! isset( $option_map[ $price->ticket_option_id ], $period_map[ $price->sale_period_id ] ) || ! $price_class::upsert( $option_map[ $price->ticket_option_id ], $period_map[ $price->sale_period_id ], $price->price ) ) {
				throw new \RuntimeException( 'Could not copy a ticket option price.' );
			}
		}
	}

	/**
	 * Shift a stored naive site-local datetime.
	 *
	 * @param string|null   $value      Stored datetime.
	 * @param \DateInterval $date_shift Site-local date shift.
	 * @return string|null Shifted datetime, or null when unset.
	 */
	private function shift_datetime( $value, $date_shift ) {
		if ( null === $value || '' === $value ) {
			return null;
		}

		$datetime = new \DateTimeImmutable( str_replace( 'T', ' ', $value ), wp_timezone() );
		return $datetime->add( $date_shift )->format( 'Y-m-d H:i:s' );
	}
}
