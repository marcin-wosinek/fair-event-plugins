<?php
/**
 * Event timing: site-local dates with independently optional times.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

defined( 'WPINC' ) || die;

/**
 * The canonical timing of an event date is an array with five keys:
 *
 *  - `start_date` / `end_date`: site-local calendar dates ('Y-m-d'), or null
 *    for an undated row. A dated row always has both; a single-day event has
 *    the same date twice.
 *  - `start_time` / `end_time`: site-local wall-clock times ('H:i:s'), each
 *    independently null when not yet known. '00:00:00' is genuine midnight,
 *    never "unknown".
 *  - `all_day`: explicitly all-day. All-day timing has no times; a missing
 *    time on a timed event does not make it all-day.
 *
 * Dates and times are wall-clock values, so nothing here converts between
 * timezones.
 *
 * The `start_datetime` / `end_datetime` columns and API fields are the legacy
 * contract, kept in step with the canonical timing until every consumer has
 * moved (see #1819). The legacy conventions are: all-day rows store
 * 00:00:00 on the start date and the inclusive end date; a timed row without
 * an end stores a null end.
 */
class EventTiming {

	/**
	 * Canonical timing keys.
	 *
	 * @var string[]
	 */
	const KEYS = array( 'start_date', 'end_date', 'start_time', 'end_time', 'all_day' );

	/**
	 * Legacy timing keys.
	 *
	 * @var string[]
	 */
	const LEGACY_KEYS = array( 'start_datetime', 'end_datetime' );

	/**
	 * Override groups of a generated occurrence's timing, keyed by group
	 * name: each group is inherited from its series or owned by the
	 * occurrence as a whole. Times and all_day form one group, so an
	 * occurrence never mixes its own time with an inherited one.
	 *
	 * @var array<string, string[]>
	 */
	const OVERRIDE_GROUPS = array(
		'dates' => array( 'start_date', 'end_date' ),
		'times' => array( 'start_time', 'end_time', 'all_day' ),
	);

	/**
	 * Database column holding each override group's marker.
	 *
	 * @var array<string, string>
	 */
	const OVERRIDE_COLUMNS = array(
		'dates' => 'dates_override',
		'times' => 'times_override',
	);

	/**
	 * Timing of an undated row.
	 *
	 * @return array Canonical timing.
	 */
	public static function undated() {
		return array(
			'start_date' => null,
			'end_date'   => null,
			'start_time' => null,
			'end_time'   => null,
			'all_day'    => false,
		);
	}

	/**
	 * Canonical timing for legacy datetime values.
	 *
	 * Lossless for every value the legacy contract could store: a timed
	 * start at 00:00:00 stays genuine midnight, a missing end becomes the
	 * start date with no end time, and all-day rows lose their placeholder
	 * times.
	 *
	 * @param string|null $start_datetime Legacy start ('Y-m-d H:i:s', 'Y-m-d\TH:i:s' or 'Y-m-d').
	 * @param string|null $end_datetime   Legacy end, or empty.
	 * @param bool        $all_day        All-day flag.
	 * @return array Canonical timing (undated when the start is missing or unreadable).
	 */
	public static function from_legacy( $start_datetime, $end_datetime, $all_day ) {
		$all_day = (bool) $all_day;
		$start   = self::split_datetime( $start_datetime );

		if ( ! $start ) {
			$timing            = self::undated();
			$timing['all_day'] = $all_day;
			return $timing;
		}

		$end = self::split_datetime( $end_datetime );

		return array(
			'start_date' => $start['date'],
			'end_date'   => $end ? $end['date'] : $start['date'],
			'start_time' => $all_day ? null : $start['time'],
			'end_time'   => ( $all_day || ! $end ) ? null : $end['time'],
			'all_day'    => $all_day,
		);
	}

	/**
	 * Legacy datetime values for a canonical timing.
	 *
	 * Transitional: legacy readers still need a value where the canonical
	 * timing has none. A missing start time is written as 00:00:00, and a
	 * missing end time on a multi-day event as 23:59:59 on the end date so
	 * date-range filtering keeps the whole last day. Nothing reads these
	 * substitutes back: see from_row().
	 *
	 * @param array $timing Canonical timing.
	 * @return array{start_datetime: string|null, end_datetime: string|null} Legacy values.
	 */
	public static function to_legacy( array $timing ) {
		$timing = array_merge( self::undated(), $timing );

		if ( empty( $timing['start_date'] ) ) {
			return array(
				'start_datetime' => null,
				'end_datetime'   => null,
			);
		}

		$end_date = $timing['end_date'] ?? $timing['start_date'];

		if ( $timing['all_day'] ) {
			return array(
				'start_datetime' => $timing['start_date'] . ' 00:00:00',
				'end_datetime'   => $end_date . ' 00:00:00',
			);
		}

		$start = $timing['start_date'] . ' ' . ( $timing['start_time'] ?? '00:00:00' );

		if ( null !== $timing['end_time'] ) {
			$end = $end_date . ' ' . $timing['end_time'];
		} elseif ( $end_date !== $timing['start_date'] ) {
			$end = $end_date . ' 23:59:59';
		} else {
			$end = null;
		}

		return array(
			'start_datetime' => $start,
			'end_datetime'   => $end,
		);
	}

	/**
	 * Canonical timing stored on a database row.
	 *
	 * Rows written before the timing columns existed (`timing_migrated` = 0)
	 * are read from their legacy columns, so an unmigrated row never reads
	 * as undated and a migrated row's absent time is never refilled from
	 * the legacy substitute.
	 *
	 * @param object $row Database row.
	 * @return array Canonical timing.
	 */
	public static function from_row( $row ) {
		$all_day = ! empty( $row->all_day );

		if ( empty( $row->timing_migrated ) ) {
			return self::from_legacy( $row->start_datetime ?? null, $row->end_datetime ?? null, $all_day );
		}

		return array(
			'start_date' => self::nullable( $row->start_date ?? null ),
			'end_date'   => self::nullable( $row->end_date ?? null ),
			'start_time' => $all_day ? null : self::nullable( $row->start_time ?? null ),
			'end_time'   => $all_day ? null : self::nullable( $row->end_time ?? null ),
			'all_day'    => $all_day,
		);
	}

	/**
	 * Database column values for a canonical timing: the canonical columns,
	 * the legacy columns kept in step, and the migration marker.
	 *
	 * @param array $timing Canonical timing.
	 * @return array<string, mixed> Column values.
	 */
	public static function columns( array $timing ) {
		$timing = array_merge( self::undated(), $timing );
		$legacy = self::to_legacy( $timing );

		return array(
			'start_date'      => $timing['start_date'],
			'end_date'        => $timing['start_date'] ? ( $timing['end_date'] ?? $timing['start_date'] ) : null,
			'start_time'      => $timing['all_day'] ? null : $timing['start_time'],
			'end_time'        => $timing['all_day'] ? null : $timing['end_time'],
			'all_day'         => $timing['all_day'] ? 1 : 0,
			'start_datetime'  => $legacy['start_datetime'],
			'end_datetime'    => $legacy['end_datetime'],
			'timing_migrated' => 1,
		);
	}

	/**
	 * `wpdb` formats for columns(), in the same order.
	 *
	 * @return string[] Formats.
	 */
	public static function column_formats() {
		return array( '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%d' );
	}

	/**
	 * Apply canonical changes to a timing.
	 *
	 * Only keys present in `$changes` change: an omitted key keeps its value
	 * and an explicit null clears it. Making an event all-day drops its
	 * times. Values must already be normalized (see normalize_changes()).
	 *
	 * @param array $timing  Current canonical timing.
	 * @param array $changes Canonical keys to change.
	 * @return array Updated timing.
	 */
	public static function merge( array $timing, array $changes ) {
		$timing = array_merge( self::undated(), $timing );

		foreach ( self::KEYS as $key ) {
			if ( array_key_exists( $key, $changes ) ) {
				$timing[ $key ] = 'all_day' === $key ? (bool) $changes[ $key ] : $changes[ $key ];
			}
		}

		if ( $timing['all_day'] ) {
			$timing['start_time'] = null;
			$timing['end_time']   = null;
		}

		return $timing;
	}

	/**
	 * Apply a legacy datetime update to a timing.
	 *
	 * An absent field leaves its part unchanged; a present empty (or null)
	 * end means "no end", and an unreadable start is ignored. A timed event
	 * without an end keeps following its start date, as a null legacy end
	 * did. REST callers drop null fields first, since there null has always
	 * meant "unchanged".
	 *
	 * @param array $timing Current canonical timing.
	 * @param array $legacy Legacy fields: any of start_datetime, end_datetime, all_day.
	 * @return array Updated timing.
	 */
	public static function merge_legacy( array $timing, array $legacy ) {
		$timing  = array_merge( self::undated(), $timing );
		$changes = array();
		$all_day = isset( $legacy['all_day'] ) ? (bool) $legacy['all_day'] : $timing['all_day'];

		if ( isset( $legacy['all_day'] ) ) {
			$changes['all_day'] = $all_day;
		}

		$start_date = $timing['start_date'];
		if ( array_key_exists( 'start_datetime', $legacy ) ) {
			$start = self::split_datetime( $legacy['start_datetime'] );
			if ( $start ) {
				$start_date            = $start['date'];
				$changes['start_date'] = $start['date'];
				$changes['start_time'] = $all_day ? null : $start['time'];
			}
		}

		if ( array_key_exists( 'end_datetime', $legacy ) ) {
			$end = self::split_datetime( $legacy['end_datetime'] );
			if ( $end ) {
				$changes['end_date'] = $end['date'];
				$changes['end_time'] = $all_day ? null : $end['time'];
			} else {
				$changes['end_date'] = $start_date;
				$changes['end_time'] = null;
			}
		} elseif ( isset( $changes['start_date'] ) && self::has_open_end( $timing ) ) {
			$changes['end_date'] = $start_date;
		}

		return self::merge( $timing, $changes );
	}

	/**
	 * Normalize canonical request values.
	 *
	 * Dates must be real calendar dates in 'Y-m-d'; times are 'H:i' or
	 * 'H:i:s' (24-hour) and come back as 'H:i:s'. Null (or an empty string)
	 * stays null. Keys absent from `$input` stay absent.
	 *
	 * @param array $input Canonical keys from a request.
	 * @return array|string Normalized changes, or an error code
	 *                      ('invalid_date' or 'invalid_time').
	 */
	public static function normalize_changes( array $input ) {
		$changes = array();

		foreach ( array( 'start_date', 'end_date' ) as $key ) {
			if ( array_key_exists( $key, $input ) ) {
				$date = self::normalize_date( $input[ $key ] );
				if ( false === $date ) {
					return 'invalid_date';
				}
				$changes[ $key ] = $date;
			}
		}

		foreach ( array( 'start_time', 'end_time' ) as $key ) {
			if ( array_key_exists( $key, $input ) ) {
				$time = self::normalize_time( $input[ $key ] );
				if ( false === $time ) {
					return 'invalid_time';
				}
				$changes[ $key ] = $time;
			}
		}

		if ( array_key_exists( 'all_day', $input ) && null !== $input['all_day'] ) {
			$changes['all_day'] = (bool) $input['all_day'];
		}

		return $changes;
	}

	/**
	 * Check a canonical timing.
	 *
	 * Missing times never take part in the ordering check: only a timing
	 * with both times on the same calendar day compares them.
	 *
	 * @param array $timing Canonical timing.
	 * @return string|null Error code, or null when valid. Codes:
	 *                     'start_date_required' (an end date or a time without a start date),
	 *                     'all_day_times' (an all-day event with a time),
	 *                     'end_date_before_start' and 'end_time_before_start'.
	 */
	public static function validate( array $timing ) {
		$timing = array_merge( self::undated(), $timing );

		if ( empty( $timing['start_date'] ) ) {
			$has_other = null !== $timing['end_date'] || null !== $timing['start_time'] || null !== $timing['end_time'];
			return $has_other ? 'start_date_required' : null;
		}

		if ( $timing['all_day'] && ( null !== $timing['start_time'] || null !== $timing['end_time'] ) ) {
			return 'all_day_times';
		}

		$end_date = $timing['end_date'] ?? $timing['start_date'];

		if ( $end_date < $timing['start_date'] ) {
			return 'end_date_before_start';
		}

		if ( $end_date === $timing['start_date']
			&& null !== $timing['start_time']
			&& null !== $timing['end_time']
			&& $timing['end_time'] < $timing['start_time']
		) {
			return 'end_time_before_start';
		}

		return null;
	}

	/**
	 * Whether a timing can be exported to calendars: ICS feeds, downloads
	 * and calendar-service links.
	 *
	 * Only an explicitly all-day event or one with both times qualifies.
	 * A missing time is never replaced by midnight, a guessed duration or
	 * an all-day entry, so such an event is left out instead.
	 *
	 * @param array $timing Canonical timing.
	 * @return bool True when the timing is exportable.
	 */
	public static function is_calendar_exportable( array $timing ) {
		$timing = array_merge( self::undated(), $timing );

		if ( empty( $timing['start_date'] ) ) {
			return false;
		}

		if ( $timing['all_day'] ) {
			return true;
		}

		return null !== $timing['start_time'] && null !== $timing['end_time'];
	}

	/**
	 * The latest purchase time at which a whole-series pass still covers a
	 * date: passes cover the dates that had not started when they were
	 * bought.
	 *
	 * A timed start is the cutoff itself, and an all-day date starts with
	 * its day. Without a start time the date's start is not known, so a
	 * pass bought at any time on its start date covers it; nothing assumes
	 * the date starts at midnight.
	 *
	 * @param array $timing Canonical timing.
	 * @return string|null Site-local 'Y-m-d H:i:s', or null for an undated row.
	 */
	public static function series_pass_cutoff( array $timing ) {
		$timing = array_merge( self::undated(), $timing );

		if ( empty( $timing['start_date'] ) ) {
			return null;
		}

		if ( $timing['all_day'] ) {
			return $timing['start_date'] . ' 00:00:00';
		}

		return $timing['start_date'] . ' ' . ( $timing['start_time'] ?? '23:59:59' );
	}

	/**
	 * A timing moved to start on another date.
	 *
	 * Keeps the calendar-day span between the start and end dates, the
	 * times (each still optional) and the all-day flag. No duration is
	 * computed from times, so a missing time stays missing.
	 *
	 * @param array  $timing Canonical timing with a start date.
	 * @param string $date   New start date (Y-m-d).
	 * @return array Canonical timing starting on `$date`.
	 */
	public static function for_date( array $timing, $date ) {
		$timing = array_merge( self::undated(), $timing );
		$span   = self::days_between( $timing['start_date'], $timing['end_date'] ?? $timing['start_date'] );

		$timing['start_date'] = $date;
		$timing['end_date']   = self::add_days( $date, $span );

		return $timing;
	}

	/**
	 * Shift a date by a number of calendar days.
	 *
	 * @param string $date Date (Y-m-d).
	 * @param int    $days Days to add; negative moves back.
	 * @return string Shifted date (Y-m-d).
	 */
	public static function add_days( $date, $days ) {
		$utc = new \DateTimeZone( 'UTC' );

		return ( new \DateTimeImmutable( $date, $utc ) )->modify( sprintf( '%+d days', (int) $days ) )->format( 'Y-m-d' );
	}

	/**
	 * Calendar days from one date to another.
	 *
	 * @param string $from Date (Y-m-d).
	 * @param string $to   Date (Y-m-d).
	 * @return int Days; negative when `$to` is earlier.
	 */
	public static function days_between( $from, $to ) {
		$utc = new \DateTimeZone( 'UTC' );

		return (int) ( new \DateTimeImmutable( $from, $utc ) )->diff( new \DateTimeImmutable( $to, $utc ) )->format( '%r%a' );
	}

	/**
	 * A generated occurrence's timing: the series timing moved to the
	 * occurrence's anchor date, with each overridden group taken from the
	 * occurrence's own timing instead.
	 *
	 * @param array               $series_timing Series (master) timing.
	 * @param string              $anchor        Anchor date (Y-m-d).
	 * @param array               $own           The occurrence's own timing.
	 * @param array<string, bool> $overrides     Overridden groups (see OVERRIDE_GROUPS).
	 * @return array Canonical timing.
	 */
	public static function resolve_occurrence( array $series_timing, $anchor, array $own, array $overrides ) {
		$timing = self::for_date( $series_timing, $anchor );
		$own    = array_merge( self::undated(), $own );

		foreach ( self::OVERRIDE_GROUPS as $group => $keys ) {
			if ( ! empty( $overrides[ $group ] ) ) {
				foreach ( $keys as $key ) {
					$timing[ $key ] = $own[ $key ];
				}
			}
		}

		if ( $timing['all_day'] ) {
			$timing['start_time'] = null;
			$timing['end_time']   = null;
		}

		return $timing;
	}

	/**
	 * Override groups whose values differ between two timings.
	 *
	 * @param array $before Canonical timing.
	 * @param array $after  Canonical timing.
	 * @return array<string, bool> Whether each group (see OVERRIDE_GROUPS) changed.
	 */
	public static function changed_groups( array $before, array $after ) {
		$before  = array_merge( self::undated(), $before );
		$after   = array_merge( self::undated(), $after );
		$changed = array();

		foreach ( self::OVERRIDE_GROUPS as $group => $keys ) {
			$changed[ $group ] = false;
			foreach ( $keys as $key ) {
				if ( ( 'all_day' === $key ? (bool) $before[ $key ] !== (bool) $after[ $key ] : $before[ $key ] !== $after[ $key ] ) ) {
					$changed[ $group ] = true;
				}
			}
		}

		return $changed;
	}

	/**
	 * Override markers stored on a database row.
	 *
	 * @param object $row Database row.
	 * @return array<string, bool> Whether each group (see OVERRIDE_GROUPS) is overridden.
	 */
	public static function overrides_from_row( $row ) {
		$overrides = array();

		foreach ( self::OVERRIDE_COLUMNS as $group => $column ) {
			$overrides[ $group ] = ! empty( $row->$column );
		}

		return $overrides;
	}

	/**
	 * Whether a timing is a timed event without an end time on its start
	 * date — what a null legacy end meant.
	 *
	 * @param array $timing Canonical timing.
	 * @return bool True for a same-day open end.
	 */
	private static function has_open_end( array $timing ) {
		return ! $timing['all_day']
			&& null === $timing['end_time']
			&& ( null === $timing['end_date'] || $timing['end_date'] === $timing['start_date'] );
	}

	/**
	 * Normalize a date value.
	 *
	 * @param mixed $value Raw value.
	 * @return string|null|false 'Y-m-d', null when empty, false when invalid.
	 */
	public static function normalize_date( $value ) {
		if ( null === $value || '' === $value ) {
			return null;
		}

		if ( ! is_string( $value ) || ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $value ) ) {
			return false;
		}

		$parsed = \DateTimeImmutable::createFromFormat( '!Y-m-d', $value );

		return ( $parsed && $parsed->format( 'Y-m-d' ) === $value ) ? $value : false;
	}

	/**
	 * Normalize a time value.
	 *
	 * @param mixed $value Raw value.
	 * @return string|null|false 'H:i:s', null when empty, false when invalid.
	 */
	public static function normalize_time( $value ) {
		if ( null === $value || '' === $value ) {
			return null;
		}

		if ( ! is_string( $value ) || ! preg_match( '/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/', $value, $matches ) ) {
			return false;
		}

		return sprintf( '%s:%s:%s', $matches[1], $matches[2], $matches[3] ?? '00' );
	}

	/**
	 * Split a legacy datetime into its date and time.
	 *
	 * @param mixed $value Legacy value.
	 * @return array{date: string, time: string}|null Parts, or null when empty or unreadable.
	 */
	private static function split_datetime( $value ) {
		if ( ! is_string( $value ) || ! preg_match( '/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(:\d{2})?)?/', $value, $matches ) ) {
			return null;
		}

		$date = self::normalize_date( $matches[1] );
		if ( ! $date ) {
			return null;
		}

		$time = isset( $matches[2] ) ? self::normalize_time( $matches[2] . ( $matches[3] ?? '' ) ) : '00:00:00';

		return array(
			'date' => $date,
			'time' => $time ? $time : '00:00:00',
		);
	}

	/**
	 * Null for empty or zero database values, the value otherwise.
	 *
	 * @param mixed $value Column value.
	 * @return string|null Value.
	 */
	private static function nullable( $value ) {
		if ( null === $value || '' === $value || '0000-00-00' === $value ) {
			return null;
		}

		return (string) $value;
	}
}
