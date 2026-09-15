<?php
/**
 * Ticket Availability Service
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\EventDates;
use FairEvents\Models\TicketSalePeriod;

defined( 'WPINC' ) || die;

/**
 * Single authority for time-based ticket availability: whether a sale period
 * or ticket type is currently on sale. Signup displays, purchase validation,
 * pricing, event metadata, and companion plugins all resolve this same
 * decision instead of re-implementing date comparisons (issue #1581).
 *
 * Every "now" comparison here uses `current_time( 'mysql' )` — the WordPress
 * site timezone — never PHP's server-time `time()`/`strtotime()`. Every
 * method also accepts an explicit `$now`/`$periods` so boundary behavior
 * stays deterministic in unit tests without a database.
 */
class TicketAvailability {

	/**
	 * Sentinel used as the effective sale_start for a period whose start is
	 * unset, so it always compares as "already started" against any real
	 * datetime string without special-casing the comparison in pick_active_period().
	 */
	const OPEN_START_SENTINEL = '0000-01-01 00:00:00';

	/**
	 * Check the ticket type's manual and scheduled enabled state. The single
	 * decision every consumer (signup display, purchase validation, event
	 * metadata) must reuse instead of comparing `disabled`/`disable_at`
	 * itself, so a scheduled or manual disable takes effect everywhere at
	 * once.
	 *
	 * @param object $ticket_type Ticket type object exposing `disabled`/`disable_at`.
	 * @param string $now         Current site datetime. Defaults to current_time( 'mysql' ).
	 * @return bool Whether the type remains enabled.
	 */
	public static function is_ticket_type_enabled( $ticket_type, $now = null ) {
		$now = $now ?? current_time( 'mysql' );

		return empty( $ticket_type->disabled )
			&& ( empty( $ticket_type->disable_at ) || $ticket_type->disable_at > $now );
	}

	/**
	 * Compute the lazy default sale_end: the day after the last occurrence,
	 * at 00:00:00 site time, preserving the half-open [start, end) range so
	 * the final day stays purchasable.
	 *
	 * @param string|null $last_occurrence_end Latest end_datetime across the event/series ('Y-m-d H:i:s'), or null.
	 * @return string|null Default sale_end ('Y-m-d H:i:s'), or null when there's no occurrence to anchor to.
	 */
	public static function compute_default_sale_end( $last_occurrence_end ) {
		if ( empty( $last_occurrence_end ) ) {
			return null;
		}

		$date = new \DateTime( $last_occurrence_end, wp_timezone() );
		$date->setTime( 0, 0, 0 );
		$date->modify( '+1 day' );

		return $date->format( 'Y-m-d H:i:s' );
	}

	/**
	 * Substitute the lazy default for any period with an unset sale_start
	 * and/or sale_end, without mutating the originals. Pure → unit-testable
	 * without a database.
	 *
	 * An unset sale_start becomes open (always already started). An unset
	 * sale_end becomes $default_end when one is available; otherwise it's
	 * left unset (pick_active_period() then never matches it as current, but
	 * the continues-fallback can still select it, same as any closed period).
	 *
	 * @param object[]    $periods     Sale periods with sale_start/sale_end strings, in sort order.
	 * @param string|null $default_end Lazy default sale_end ('Y-m-d H:i:s'), or null.
	 * @return object[] Periods with unset windows resolved; explicit values untouched.
	 */
	public static function apply_default_window( $periods, $default_end ) {
		$resolved = array();

		foreach ( $periods as $period ) {
			$resolved_period = clone $period;

			if ( empty( $resolved_period->sale_start ) ) {
				$resolved_period->sale_start = self::OPEN_START_SENTINEL;
			}

			if ( empty( $resolved_period->sale_end ) && $default_end ) {
				$resolved_period->sale_end = $default_end;
			}

			$resolved[] = $resolved_period;
		}

		return $resolved;
	}

	/**
	 * Pure period-selection math, split out from resolve_active_sale_period()
	 * for unit testing without a database.
	 *
	 * @param object[] $periods   Sale periods with sale_start/sale_end strings, in sort order.
	 * @param string   $now       Current datetime string ('Y-m-d H:i:s'), comparable lexically.
	 * @param bool     $continues Whether the continues_pricing_period fallback is enabled.
	 * @return object|null Active period, the fallback period, or null.
	 */
	public static function pick_active_period( $periods, $now, $continues ) {
		$active_period = null;
		$last_index    = count( $periods ) - 1;

		foreach ( $periods as $index => $period ) {
			// Half-open interval: sale_start <= now < sale_end.
			if ( $period->sale_start <= $now && $period->sale_end > $now ) {
				return $period;
			}
			if ( $continues && $index === $last_index && $period->sale_start <= $now ) {
				$active_period = $period;
			}
		}

		return $active_period;
	}

	/**
	 * Pick the earliest period that hasn't started yet, for callers wanting a
	 * "sales open soon" fallback when nothing is active right now (e.g. a
	 * search crawl hitting the page before a sale window opens). Pure,
	 * DB-free — split out for unit testing without a database, mirroring
	 * pick_active_period().
	 *
	 * @param object[] $periods Sale periods with sale_start strings, post apply_default_window().
	 * @param string   $now     Current datetime string ('Y-m-d H:i:s'), comparable lexically.
	 * @return object|null Earliest not-yet-started period, or null when every period has already started.
	 */
	public static function pick_upcoming_period( $periods, $now ) {
		$upcoming = null;

		foreach ( $periods as $period ) {
			if ( $period->sale_start > $now && ( ! $upcoming || $period->sale_start < $upcoming->sale_start ) ) {
				$upcoming = $period;
			}
		}

		return $upcoming;
	}

	/**
	 * Resolve an active/upcoming/count classification from already-fetched
	 * periods. Pure — split out from resolve_sale_period_context() for unit
	 * testing without a database.
	 *
	 * @param object[]    $periods     Configured sale periods.
	 * @param string      $now         Current site datetime.
	 * @param string|null $default_end Lazy default sale end.
	 * @param bool        $continues   Whether the continues_pricing_period fallback is enabled.
	 * @return array{active_period: object|null, upcoming_period: object|null, sale_period_count: int}
	 */
	public static function resolve_period_context_from_periods( array $periods, $now, $default_end, $continues = false ) {
		$period_count     = count( $periods );
		$resolved_periods = self::apply_default_window( $periods, $default_end );

		return array(
			'active_period'     => self::pick_active_period( $resolved_periods, $now, $continues ),
			'upcoming_period'   => self::pick_upcoming_period( $resolved_periods, $now ),
			'sale_period_count' => $period_count,
		);
	}

	/**
	 * Resolve the active/upcoming/count classification for an event date
	 * from the database.
	 *
	 * Periods use a half-open day range [sale_start, sale_end) in the site
	 * timezone: sale_start is the first day on sale (00:00:00 site time) and
	 * sale_end is the first day no longer on sale (00:00:00 site time).
	 *
	 * A period with an unset sale_start/sale_end is not "closed" — it
	 * resolves lazily: an open start (always on sale) and/or an end of the
	 * day after the event/series' last occurrence, computed fresh on every
	 * call so it automatically tracks series changes.
	 *
	 * @param int  $event_date_id Event date ID.
	 * @param bool $continues     Whether the continues_pricing_period fallback is enabled.
	 * @return array{active_period: TicketSalePeriod|null, upcoming_period: TicketSalePeriod|null, sale_period_count: int}
	 */
	public static function resolve_sale_period_context( $event_date_id, $continues = false ) {
		$now          = current_time( 'mysql' );
		$sale_periods = TicketSalePeriod::get_all_by_event_date_id( $event_date_id );
		$default_end  = self::compute_default_sale_end( EventDates::get_last_occurrence_end( $event_date_id ) );

		return self::resolve_period_context_from_periods( $sale_periods, $now, $default_end, $continues );
	}

	/**
	 * Resolve the currently active sale period for an event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return TicketSalePeriod|null Active period or null.
	 */
	public static function resolve_active_sale_period( $event_date_id ) {
		return self::resolve_sale_period_context( $event_date_id )['active_period'];
	}
}
