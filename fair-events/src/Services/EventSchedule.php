<?php
/**
 * Event Schedule Service
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\EventDates;
use FairEvents\Models\EventDateSetting;
use FairEvents\Models\ScheduleItem;
use FairEvents\Models\TicketOption;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * The program of an event: workshops linked to ticket options, and program
 * items of their own. Owns reading and saving the schedule, and the booking
 * status it gives a linked ticket option — enforced by ActivitySelection and
 * TicketCapacity whether or not the schedule is still enabled.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EventSchedule {

	/**
	 * Most entries one schedule accepts.
	 */
	const MAX_ITEMS = 200;

	/**
	 * The event date a schedule is stored on: the series master for a
	 * generated occurrence, the event date itself otherwise.
	 *
	 * @param object $event_date Event date (needs id, occurrence_type, master_id).
	 * @return int
	 */
	public static function config_event_date_id( $event_date ) {
		return ( 'generated' === $event_date->occurrence_type && ! empty( $event_date->master_id ) )
			? (int) $event_date->master_id
			: (int) $event_date->id;
	}

	/**
	 * Whether the organizer enabled the schedule for an event date.
	 *
	 * @param int $config_event_date_id Event date the schedule is stored on.
	 * @return bool
	 */
	public static function is_enabled( $config_event_date_id ) {
		return '1' === (string) EventDateSetting::get( (int) $config_event_date_id, 'schedule_enabled' );
	}

	/**
	 * The ticket options of an event date that cannot be chosen with a
	 * ticket. Applies whether or not the schedule is enabled, so hiding the
	 * schedule never puts a workshop back on sale.
	 *
	 * @param int $config_event_date_id Event date the option catalogue belongs to.
	 * @return int[] Ticket option IDs.
	 */
	public static function non_bookable_option_ids( $config_event_date_id ) {
		return ScheduleItem::get_non_bookable_option_ids_by_event_date_id( (int) $config_event_date_id );
	}

	/**
	 * The buyer-facing error for a workshop that is not bookable.
	 *
	 * @param string $option_name      Workshop name.
	 * @param int    $ticket_option_id Ticket option ID.
	 * @return WP_Error
	 */
	public static function not_bookable_error( $option_name, $ticket_option_id = 0 ) {
		return new WP_Error(
			'ticket_option_not_bookable',
			sprintf(
				/* translators: %s: activity name */
				__( '"%s" cannot be booked. Reload the page and choose again.', 'fair-events' ),
				$option_name
			),
			array(
				'status'           => 409,
				'ticket_option_id' => (int) $ticket_option_id,
			)
		);
	}

	/**
	 * Refuse a ticket configuration save that would delete a ticket option
	 * the schedule links to. Call before the first write.
	 *
	 * @param int   $event_date_id   Event date the options belong to.
	 * @param int[] $kept_option_ids Option IDs the save keeps.
	 * @return WP_Error|null 409 naming the scheduled options, null when the save is safe.
	 */
	public static function guard_option_removal( $event_date_id, array $kept_option_ids ) {
		$kept_option_ids = array_map( 'intval', $kept_option_ids );
		$names           = array();
		foreach ( TicketOption::get_all_by_event_date_id( (int) $event_date_id ) as $option ) {
			if ( ! in_array( (int) $option->id, $kept_option_ids, true ) ) {
				$names[ (int) $option->id ] = $option->name;
			}
		}

		$scheduled = ScheduleItem::filter_linked_option_ids( array_keys( $names ) );
		if ( ! $scheduled ) {
			return null;
		}

		$scheduled_names = array_map(
			static function ( $option_id ) use ( $names ) {
				return $names[ $option_id ];
			},
			$scheduled
		);

		return new WP_Error(
			'ticket_option_scheduled',
			sprintf(
				/* translators: %s: comma-separated add-on names */
				_n(
					'This add-on is on the schedule: %s. Remove it from the Schedule tab before deleting it here.',
					'These add-ons are on the schedule: %s. Remove them from the Schedule tab before deleting them here.',
					count( $scheduled_names ),
					'fair-events'
				),
				implode( ', ', $scheduled_names )
			),
			array(
				'status'            => 409,
				'ticket_option_ids' => array_values( $scheduled ),
			)
		);
	}

	/**
	 * The schedule of an event date, shaped for the REST response. A
	 * generated occurrence gets its series' schedule with every date shifted
	 * to the occurrence, read-only.
	 *
	 * @param object $event_date Event date (EventDates).
	 * @return array
	 */
	public static function get_payload( $event_date ) {
		$config_id     = self::config_event_date_id( $event_date );
		$is_occurrence = (int) $event_date->id !== $config_id;
		$date_shift    = null;

		if ( $is_occurrence ) {
			$master = EventDates::get_by_id( $config_id );
			if ( $master && $master->start_datetime && $event_date->start_datetime ) {
				$date_shift = self::to_datetime( $master->start_datetime )->diff( self::to_datetime( $event_date->start_datetime ) );
			}
		}

		$options = array();
		foreach ( TicketOption::get_all_by_event_date_id( $config_id ) as $option ) {
			$options[ (int) $option->id ] = $option;
		}

		$items     = array();
		$warnings  = array();
		$scheduled = array();
		foreach ( ScheduleItem::get_all_by_event_date_id( $config_id ) as $item ) {
			$option = $item->ticket_option_id ? ( $options[ $item->ticket_option_id ] ?? null ) : null;
			$start  = $date_shift ? self::shift_datetime( $item->start_datetime, $date_shift ) : $item->start_datetime;
			$end    = $date_shift ? self::shift_datetime( $item->end_datetime, $date_shift ) : $item->end_datetime;

			if ( $item->ticket_option_id ) {
				$scheduled[ $item->ticket_option_id ] = true;
			}

			$items[] = array(
				'id'               => $item->id,
				'ticket_option_id' => $item->ticket_option_id,
				'bookable'         => $item->bookable,
				// A linked workshop is named by its ticket option, so a
				// rename in Prices shows here without a second edit.
				'title'            => $option ? $option->name : $item->title,
				'start_datetime'   => $start,
				'end_datetime'     => $end,
				'description'      => $item->description,
				'location'         => $item->location,
			);

			if ( self::is_outside_event( $start, $end, $event_date ) ) {
				$warnings[] = array(
					'id'      => $item->id,
					'message' => __( 'This entry is outside the event\'s dates.', 'fair-events' ),
				);
			}
		}

		return array(
			'event_date_id'          => (int) $event_date->id,
			'schedule_event_date_id' => $config_id,
			'schedule_enabled'       => self::is_enabled( $config_id ),
			'read_only'              => $is_occurrence,
			'items'                  => $items,
			'warnings'               => $warnings,
			'options'                => array_values(
				array_map(
					static function ( $option ) use ( $scheduled ) {
						return array(
							'id'        => (int) $option->id,
							'name'      => $option->name,
							'scheduled' => isset( $scheduled[ (int) $option->id ] ),
						);
					},
					$options
				)
			),
		);
	}

	/**
	 * Replace the schedule of an event date with the submitted entries.
	 * Everything is validated first; nothing is written unless every entry
	 * is valid. A workshop is only marked not bookable while no ticket or
	 * reservation includes it, checked under the same ticket-option row
	 * locks a purchase takes (see TicketCapacity::with_capacity_lock()).
	 *
	 * @param object $event_date Event date (EventDates).
	 * @param array  $raw_items  Submitted entries, in display order.
	 * @return array|WP_Error The saved schedule (get_payload()), or an error whose data lists `errors` keyed by entry and field.
	 * @throws \Throwable Re-thrown after rolling back.
	 */
	public static function save( $event_date, array $raw_items ) {
		global $wpdb;

		$config_id = self::config_event_date_id( $event_date );
		if ( (int) $event_date->id !== $config_id ) {
			return new WP_Error(
				'schedule_managed_on_series',
				__( 'The schedule is managed on the series. Open the series to change it.', 'fair-events' ),
				array( 'status' => 409 )
			);
		}

		if ( ! self::is_enabled( $config_id ) ) {
			return new WP_Error(
				'schedule_disabled',
				__( 'The schedule is not enabled for this event. Enable it in Prices first.', 'fair-events' ),
				array( 'status' => 409 )
			);
		}

		if ( count( $raw_items ) > self::MAX_ITEMS ) {
			return new WP_Error(
				'schedule_too_long',
				sprintf(
					/* translators: %d: maximum number of schedule entries */
					__( 'A schedule can hold up to %d entries.', 'fair-events' ),
					self::MAX_ITEMS
				),
				array( 'status' => 400 )
			);
		}

		$options = array();
		foreach ( TicketOption::get_all_by_event_date_id( $config_id ) as $option ) {
			$options[ (int) $option->id ] = $option;
		}

		$errors = array();
		$clean  = array();
		foreach ( array_values( $raw_items ) as $index => $raw ) {
			$clean[ $index ] = self::sanitize_item( is_array( $raw ) ? $raw : array(), $index, $options, $clean, $errors );
		}

		$wpdb->query( 'START TRANSACTION' );

		try {
			// Lock before the first plain read, so this transaction sees
			// every purchase committed before it and later purchases wait
			// for its outcome.
			$wpdb->get_col(
				$wpdb->prepare(
					'SELECT id FROM %i WHERE event_date_id = %d ORDER BY id ASC FOR UPDATE',
					$wpdb->prefix . 'fair_events_ticket_options',
					$config_id
				)
			);

			$existing = array();
			foreach ( ScheduleItem::get_all_by_event_date_id( $config_id ) as $item ) {
				$existing[ $item->id ] = $item;
			}

			self::check_against_stored( $clean, $existing, $options, $config_id, $errors );

			if ( $errors ) {
				$wpdb->query( 'ROLLBACK' );
				return self::validation_error( $errors );
			}

			$saved = self::write( $clean, $existing, $config_id );
		} catch ( \Throwable $e ) {
			$wpdb->query( 'ROLLBACK' );
			throw $e;
		}

		if ( ! $saved ) {
			$wpdb->query( 'ROLLBACK' );
			return new WP_Error(
				'schedule_save_failed',
				__( 'The schedule could not be saved. Nothing was changed.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		$wpdb->query( 'COMMIT' );

		return self::get_payload( $event_date );
	}

	/**
	 * Copy a schedule to another event date, with its dates shifted and its
	 * workshops pointing at the copied ticket options.
	 *
	 * @param int             $source_id      Source event date ID.
	 * @param int             $destination_id Destination event date ID.
	 * @param array<int, int> $option_map     Old-to-new ticket option ID map.
	 * @param \DateInterval   $date_shift     Site-local shift from source to destination.
	 * @return void
	 * @throws \RuntimeException When an entry cannot be copied or its workshop was not copied.
	 */
	public static function copy( $source_id, $destination_id, array $option_map, $date_shift ) {
		foreach ( ScheduleItem::get_all_by_event_date_id( (int) $source_id ) as $item ) {
			if ( $item->ticket_option_id && ! isset( $option_map[ $item->ticket_option_id ] ) ) {
				throw new \RuntimeException( 'Could not remap a schedule entry.' );
			}

			$new_id = ScheduleItem::create(
				array(
					'event_date_id'    => (int) $destination_id,
					'ticket_option_id' => $item->ticket_option_id ? $option_map[ $item->ticket_option_id ] : null,
					'bookable'         => $item->bookable,
					'title'            => $item->title,
					'start_datetime'   => self::shift_datetime( $item->start_datetime, $date_shift ),
					'end_datetime'     => self::shift_datetime( $item->end_datetime, $date_shift ),
					'description'      => $item->description,
					'location'         => $item->location,
					'sort_order'       => $item->sort_order,
				)
			);

			if ( ! $new_id ) {
				throw new \RuntimeException( 'Could not copy a schedule entry.' );
			}
		}
	}

	/**
	 * Parse a submitted naive site-local datetime.
	 *
	 * @param mixed $value 'YYYY-MM-DD HH:MM' or 'YYYY-MM-DD HH:MM:SS', with a space or a T.
	 * @return string|null 'Y-m-d H:i:s', or null when it is not a real date and time.
	 */
	public static function parse_datetime( $value ) {
		if ( ! is_string( $value ) || ! preg_match( '/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/', trim( $value ), $m ) ) {
			return null;
		}

		$second = isset( $m[6] ) ? (int) $m[6] : 0;
		if ( ! checkdate( (int) $m[2], (int) $m[3], (int) $m[1] ) || (int) $m[4] > 23 || (int) $m[5] > 59 || $second > 59 ) {
			return null;
		}

		return sprintf( '%s-%s-%s %s:%s:%02d', $m[1], $m[2], $m[3], $m[4], $m[5], $second );
	}

	/**
	 * Sanitize one submitted entry and record what is wrong with it on its
	 * own, without looking at what is stored.
	 *
	 * @param array   $raw     Submitted entry.
	 * @param int     $index   Position in the submission.
	 * @param array   $options The event's ticket options, keyed by ID.
	 * @param array[] $earlier Entries sanitized before this one.
	 * @param array[] $errors  Collected errors, added to by reference.
	 * @return array Sanitized entry.
	 */
	private static function sanitize_item( array $raw, $index, array $options, array $earlier, array &$errors ) {
		$item = array(
			'index'            => (int) $index,
			'key'              => isset( $raw['key'] ) && is_scalar( $raw['key'] ) ? sanitize_text_field( (string) $raw['key'] ) : (string) $index,
			'id'               => isset( $raw['id'] ) && is_scalar( $raw['id'] ) ? absint( $raw['id'] ) : 0,
			'ticket_option_id' => isset( $raw['ticket_option_id'] ) && is_scalar( $raw['ticket_option_id'] ) ? absint( $raw['ticket_option_id'] ) : 0,
			'bookable'         => isset( $raw['bookable'] ) && rest_sanitize_boolean( $raw['bookable'] ),
			'title'            => isset( $raw['title'] ) && is_scalar( $raw['title'] ) ? sanitize_text_field( (string) $raw['title'] ) : '',
			'description'      => isset( $raw['description'] ) && is_scalar( $raw['description'] ) ? sanitize_textarea_field( (string) $raw['description'] ) : '',
			'location'         => isset( $raw['location'] ) && is_scalar( $raw['location'] ) ? sanitize_text_field( (string) $raw['location'] ) : '',
			'start_datetime'   => self::parse_datetime( $raw['start_datetime'] ?? null ),
			'end_datetime'     => self::parse_datetime( $raw['end_datetime'] ?? null ),
		);

		$add_error = static function ( $field, $code, $message ) use ( $item, &$errors ) {
			$errors[] = array(
				'index'   => $item['index'],
				'key'     => $item['key'],
				'id'      => $item['id'] ? $item['id'] : null,
				'field'   => $field,
				'code'    => $code,
				'message' => $message,
			);
		};

		if ( null === $item['start_datetime'] ) {
			$add_error( 'start_datetime', 'invalid_datetime', __( 'Enter a valid start date and time.', 'fair-events' ) );
		}
		if ( null === $item['end_datetime'] ) {
			$add_error( 'end_datetime', 'invalid_datetime', __( 'Enter a valid end date and time.', 'fair-events' ) );
		}
		if ( null !== $item['start_datetime'] && null !== $item['end_datetime'] && $item['end_datetime'] <= $item['start_datetime'] ) {
			$add_error( 'end_datetime', 'end_before_start', __( 'The end must be after the start.', 'fair-events' ) );
		}

		if ( mb_strlen( $item['location'] ) > 255 ) {
			$add_error( 'location', 'too_long', __( 'Use 255 characters or fewer.', 'fair-events' ) );
		}

		if ( $item['ticket_option_id'] ) {
			// The name comes from the ticket option; nothing is stored here.
			$item['title'] = '';

			if ( ! isset( $options[ $item['ticket_option_id'] ] ) ) {
				$add_error( 'ticket_option_id', 'invalid_option', __( 'This workshop does not belong to this event. Choose one from Prices.', 'fair-events' ) );
			} elseif ( in_array( $item['ticket_option_id'], array_column( $earlier, 'ticket_option_id' ), true ) ) {
				$add_error( 'ticket_option_id', 'duplicate_option', __( 'This workshop is already on the schedule.', 'fair-events' ) );
			}
		} else {
			if ( $item['bookable'] ) {
				$add_error( 'bookable', 'bookable_requires_option', __( 'Only a workshop from Prices can be bookable. Add it as a workshop, or mark this item Not bookable.', 'fair-events' ) );
			}
			if ( '' === $item['title'] ) {
				$add_error( 'title', 'title_required', __( 'Enter a title.', 'fair-events' ) );
			} elseif ( mb_strlen( $item['title'] ) > 255 ) {
				$add_error( 'title', 'too_long', __( 'Use 255 characters or fewer.', 'fair-events' ) );
			}
		}

		if ( $item['id'] && in_array( $item['id'], array_column( $earlier, 'id' ), true ) ) {
			$add_error( 'id', 'duplicate_item', __( 'This schedule entry was sent twice.', 'fair-events' ) );
		}

		return $item;
	}

	/**
	 * Check the sanitized entries against the stored schedule, under the
	 * ticket-option locks: every referenced entry belongs to this event, a
	 * workshop keeps its ticket option, and no workshop that tickets or
	 * reservations include is marked not bookable.
	 *
	 * @param array[] $clean     Sanitized entries.
	 * @param array   $existing  Stored ScheduleItem objects, keyed by ID.
	 * @param array   $options   The event's ticket options, keyed by ID.
	 * @param int     $config_id Event date the schedule is stored on.
	 * @param array[] $errors    Collected errors, added to by reference.
	 * @return void
	 */
	private static function check_against_stored( array $clean, array $existing, array $options, $config_id, array &$errors ) {
		$stored_bookable = array();
		foreach ( $existing as $stored ) {
			if ( $stored->ticket_option_id ) {
				$stored_bookable[ $stored->ticket_option_id ] = $stored->bookable;
			}
		}

		foreach ( $clean as $item ) {
			$add_error = static function ( $field, $code, $message ) use ( $item, &$errors ) {
				$errors[] = array(
					'index'   => $item['index'],
					'key'     => $item['key'],
					'id'      => $item['id'] ? $item['id'] : null,
					'field'   => $field,
					'code'    => $code,
					'message' => $message,
				);
			};

			$stored = $item['id'] ? ( $existing[ $item['id'] ] ?? null ) : null;
			if ( $item['id'] && ! $stored ) {
				$add_error( 'id', 'invalid_item', __( 'This schedule entry does not belong to this event.', 'fair-events' ) );
				continue;
			}

			if ( $stored && $stored->ticket_option_id && $stored->ticket_option_id !== $item['ticket_option_id'] ) {
				$add_error( 'ticket_option_id', 'option_link_locked', __( 'A workshop entry keeps its workshop. Remove this entry and add the other workshop instead.', 'fair-events' ) );
				continue;
			}

			$option_id = $item['ticket_option_id'];
			if ( ! $option_id || ! isset( $options[ $option_id ] ) || $item['bookable'] ) {
				continue;
			}

			// An option without an entry yet is bookable, so linking it as
			// not bookable is the same change as switching an entry.
			$was_bookable = $stored_bookable[ $option_id ] ?? true;
			if ( $was_bookable && TicketCapacity::count_ticket_option_all_dates( $option_id, (int) $config_id ) > 0 ) {
				$add_error(
					'bookable',
					'booking_has_dependents',
					sprintf(
						/* translators: %s: workshop name */
						__( '"%s" is part of tickets or reservations already, so it cannot be marked Not bookable. Move or cancel those first.', 'fair-events' ),
						$options[ $option_id ]->name
					)
				);
			}
		}
	}

	/**
	 * Write the validated entries: remove the stored ones left out, then
	 * update and insert in display order.
	 *
	 * @param array[] $clean     Sanitized entries.
	 * @param array   $existing  Stored ScheduleItem objects, keyed by ID.
	 * @param int     $config_id Event date the schedule is stored on.
	 * @return bool False when any write failed.
	 */
	private static function write( array $clean, array $existing, $config_id ) {
		$kept_ids = array_filter( array_column( $clean, 'id' ) );
		foreach ( array_keys( $existing ) as $stored_id ) {
			if ( ! in_array( $stored_id, $kept_ids, true ) && ! ScheduleItem::delete( $stored_id ) ) {
				return false;
			}
		}

		foreach ( $clean as $item ) {
			$data = array(
				'event_date_id'    => (int) $config_id,
				'ticket_option_id' => $item['ticket_option_id'] ? $item['ticket_option_id'] : null,
				'bookable'         => $item['bookable'],
				'title'            => $item['title'],
				'start_datetime'   => $item['start_datetime'],
				'end_datetime'     => $item['end_datetime'],
				'description'      => $item['description'],
				'location'         => $item['location'],
				'sort_order'       => $item['index'],
			);

			$ok = $item['id'] ? ScheduleItem::update( $item['id'], $data ) : ScheduleItem::create( $data );
			if ( ! $ok ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Build the REST error for a rejected save. A save rejected only because
	 * of tickets or reservations is a conflict (409); anything else is a
	 * validation failure (400).
	 *
	 * @param array[] $errors Collected errors.
	 * @return WP_Error
	 */
	private static function validation_error( array $errors ) {
		$only_conflicts = ! array_filter(
			$errors,
			static function ( $error ) {
				return 'booking_has_dependents' !== $error['code'];
			}
		);

		return $only_conflicts
			? new WP_Error(
				'schedule_booking_locked',
				$errors[0]['message'],
				array(
					'status' => 409,
					'errors' => $errors,
				)
			)
			: new WP_Error(
				'schedule_invalid',
				__( 'The schedule was not saved. Check the marked fields and save again.', 'fair-events' ),
				array(
					'status' => 400,
					'errors' => $errors,
				)
			);
	}

	/**
	 * Whether an entry starts before the event's first day or ends after its
	 * last one. Compared by calendar day, so a warm-up before the event's
	 * opening time on the same day is not flagged.
	 *
	 * @param string $start      Entry start.
	 * @param string $end        Entry end.
	 * @param object $event_date Event date (needs start_datetime, end_datetime).
	 * @return bool
	 */
	private static function is_outside_event( $start, $end, $event_date ) {
		if ( empty( $event_date->start_datetime ) ) {
			return false;
		}

		$first_day = substr( str_replace( 'T', ' ', $event_date->start_datetime ), 0, 10 );
		$last_day  = ! empty( $event_date->end_datetime )
			? substr( str_replace( 'T', ' ', $event_date->end_datetime ), 0, 10 )
			: $first_day;

		return substr( $start, 0, 10 ) < $first_day || substr( $end, 0, 10 ) > max( $first_day, $last_day );
	}

	/**
	 * Read a stored naive site-local datetime.
	 *
	 * @param string $value Stored datetime.
	 * @return \DateTimeImmutable
	 */
	private static function to_datetime( $value ) {
		return new \DateTimeImmutable( str_replace( 'T', ' ', $value ), wp_timezone() );
	}

	/**
	 * Shift a stored naive site-local datetime.
	 *
	 * @param string        $value      Stored datetime.
	 * @param \DateInterval $date_shift Site-local shift.
	 * @return string Shifted datetime.
	 */
	private static function shift_datetime( $value, $date_shift ) {
		return self::to_datetime( $value )->add( $date_shift )->format( 'Y-m-d H:i:s' );
	}
}
