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
	 * Resolve each period's effective sale_start/sale_end according to its
	 * position in the sequence, without mutating the originals. Pure →
	 * unit-testable without a database.
	 *
	 * Only the first period may infer a missing start: it becomes the
	 * current site-local calendar day at midnight, and only while that day
	 * precedes the period's effective end — an already-elapsed period never
	 * reactivates. Only the last period may infer a missing end: it becomes
	 * $default_end when one is available. A missing boundary anywhere else
	 * (an interior period, or a first/last period with nothing to infer
	 * from) is left null so pick_active_period()/pick_upcoming_period()
	 * never select it — no historical sentinel is used, so an expired or
	 * misconfigured period can never look active.
	 *
	 * @param object[]    $periods     Sale periods with sale_start/sale_end strings, in sort order.
	 * @param string      $now         Current site datetime ('Y-m-d H:i:s'), comparable lexically.
	 * @param string|null $default_end Lazy default sale_end for the last period ('Y-m-d H:i:s'), or null.
	 * @return object[] Periods with resolvable boundaries filled in; explicit values untouched, unresolved ones null.
	 */
	public static function resolve_periods( $periods, $now, $default_end ) {
		$resolved   = array();
		$last_index = count( $periods ) - 1;
		$today      = substr( $now, 0, 10 ) . ' 00:00:00';

		foreach ( $periods as $index => $period ) {
			$resolved_period = clone $period;

			if ( empty( $resolved_period->sale_end ) ) {
				$resolved_period->sale_end = ( $index === $last_index ) ? $default_end : null;
			}

			if ( empty( $resolved_period->sale_start ) ) {
				$can_infer_start = 0 === $index
					&& ! empty( $resolved_period->sale_end )
					&& $today < $resolved_period->sale_end;

				$resolved_period->sale_start = $can_infer_start ? $today : null;
			}

			$resolved[] = $resolved_period;
		}

		return $resolved;
	}

	/**
	 * Pure period-selection math, split out from resolve_active_sale_period()
	 * for unit testing without a database.
	 *
	 * @param object[] $periods   Sale periods with sale_start/sale_end strings, post resolve_periods().
	 * @param string   $now       Current datetime string ('Y-m-d H:i:s'), comparable lexically.
	 * @param bool     $continues Whether the continues_pricing_period fallback is enabled.
	 * @return object|null Active period, the fallback period, or null.
	 */
	public static function pick_active_period( $periods, $now, $continues ) {
		$last_index = count( $periods ) - 1;

		foreach ( $periods as $period ) {
			if ( empty( $period->sale_start ) || empty( $period->sale_end ) ) {
				continue;
			}
			// Half-open interval: sale_start <= now < sale_end.
			if ( $period->sale_start <= $now && $period->sale_end > $now ) {
				return $period;
			}
		}

		if ( $continues && $last_index >= 0 ) {
			$last_period = $periods[ $last_index ];
			if ( ! empty( $last_period->sale_start ) && $last_period->sale_start <= $now ) {
				return $last_period;
			}
		}

		return null;
	}

	/**
	 * Pick the earliest period that hasn't started yet, for callers wanting a
	 * "sales open soon" fallback when nothing is active right now (e.g. a
	 * search crawl hitting the page before a sale window opens). Pure,
	 * DB-free — split out for unit testing without a database, mirroring
	 * pick_active_period().
	 *
	 * @param object[] $periods Sale periods with sale_start strings, post resolve_periods().
	 * @param string   $now     Current datetime string ('Y-m-d H:i:s'), comparable lexically.
	 * @return object|null Earliest not-yet-started period, or null when every period has already started.
	 */
	public static function pick_upcoming_period( $periods, $now ) {
		$upcoming = null;

		foreach ( $periods as $period ) {
			if ( empty( $period->sale_start ) ) {
				continue;
			}
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
		$resolved_periods = self::resolve_periods( $periods, $now, $default_end );

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
	 * A period with an unset sale_start/sale_end is not necessarily "closed"
	 * — the first period's start and the last period's end resolve lazily
	 * (today's site-local date, and the day after the event/series' final
	 * active occurrence, respectively), computed fresh on every call so they
	 * automatically track series changes. An unset boundary anywhere else
	 * stays unresolved and is never selected as active.
	 *
	 * @param int  $event_date_id Event date ID.
	 * @param bool $continues     Whether the continues_pricing_period fallback is enabled.
	 * @return array{active_period: TicketSalePeriod|null, upcoming_period: TicketSalePeriod|null, sale_period_count: int}
	 */
	public static function resolve_sale_period_context( $event_date_id, $continues = false ) {
		$now          = current_time( 'mysql' );
		$sale_periods = TicketSalePeriod::get_all_by_event_date_id( $event_date_id );
		$default_end  = self::compute_default_sale_end( EventDates::get_last_occurrence_boundary( $event_date_id ) );

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
