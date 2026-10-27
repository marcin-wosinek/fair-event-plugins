<?php
/**
 * Weekly Events Provider
 *
 * Aggregates events for a given event source grouped by day for a specific ISO week.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Database\EventSourceRepository;
use FairEvents\Helpers\DateHelper;

defined( 'WPINC' ) || die;

/**
 * The events of a week, for weekly notifications and the weekly digest.
 *
 * Built on EventFeedProvider + group_by_day(). for_notification() is what
 * every notification channel reads its events from; get_week()'s return
 * shape is preserved exactly for older consumers in other plugins.
 */
class WeeklyEventsProvider {

	/**
	 * Selection of every published event of this site, instead of a source.
	 */
	public const LOCAL_EVENTS = '@local';

	/**
	 * Get the week's events for an event source.
	 *
	 * @param string   $source_slug Event source slug.
	 * @param int|null $year        ISO year, or null for the current week.
	 * @param int|null $week        ISO week number, or null for the current week.
	 * @return array|\WP_Error Array with 'source', 'week', 'days' keys, or WP_Error if the source is not found.
	 */
	public function get_week( $source_slug, $year = null, $week = null ) {
		$repository = new EventSourceRepository();
		$source     = $repository->get_by_slug( $source_slug );

		if ( ! $source ) {
			return new \WP_Error(
				'not_found',
				__( 'Event feed not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		if ( ! $year || ! $week ) {
			$now  = new \DateTime( 'now', new \DateTimeZone( wp_timezone_string() ) );
			$year = (int) $now->format( 'o' );
			$week = (int) $now->format( 'W' );
		}

		// Calculate week boundaries (Monday-based).
		$date = new \DateTime();
		$date->setISODate( $year, $week );
		$week_start = $date->format( 'Y-m-d' );
		$date->modify( '+6 days' );
		$week_end = $date->format( 'Y-m-d' );

		$occurrences = ( new EventFeedProvider() )->get_occurrences(
			$week_start . ' 00:00:00',
			$week_end . ' 23:59:59',
			array(
				'event_source_slugs' => array( $source_slug ),
			)
		);

		$week_data = self::week_data(
			array(
				'start' => $week_start,
				'end'   => $week_end,
			),
			$occurrences
		);

		return array(
			'source' => array(
				'name'     => $source['name'],
				'slug'     => $source['slug'],
				'page_url' => $source['page_id'] ? get_permalink( $source['page_id'] ) : null,
			),
			'week'   => array(
				'year'  => $year,
				'week'  => $week,
				'start' => $week_start,
				'end'   => $week_end,
			),
			'days'   => $week_data['days'],
		);
	}

	/**
	 * A week's events for a notification channel.
	 *
	 * Every notification channel reads its events here, so a given selection
	 * and week lists the same events whichever channel sends them. A source
	 * that is missing or disabled is an error: the selection is never widened
	 * to other events.
	 *
	 * @param array{start: string, end: string} $week      Site-local 'Y-m-d' week boundaries.
	 * @param string                            $selection {@see self::LOCAL_EVENTS} or an event source slug.
	 * @param string|false                      $language  Polylang language slug to translate events to,
	 *                                                     or false to leave them untranslated.
	 * @return array|\WP_Error {@see self::week_data()}, plus `source`: id, name,
	 *     slug and page_url of the selected source, or null for local events.
	 */
	public function for_notification( array $week, $selection, $language = false ) {
		$source = $this->selected_source( $selection );
		if ( is_wp_error( $source ) ) {
			return $source;
		}

		$occurrences = EventsWeekSummary::occurrences(
			$week,
			array(
				'categories'         => array(),
				'event_source_slugs' => $source ? array( $source['slug'] ) : array(),
				'include_drafts'     => false,
			),
			$language ? $language : false
		);

		return array(
			'source' => $source
				? array(
					'id'       => (int) $source['id'],
					'name'     => $source['name'],
					'slug'     => $source['slug'],
					'page_url' => $source['page_id'] ? get_permalink( $source['page_id'] ) : null,
				)
				: null,
		) + self::week_data( $week, $occurrences );
	}

	/**
	 * Check that a selection can still be resolved.
	 *
	 * @param string $selection {@see self::LOCAL_EVENTS} or an event source slug.
	 * @return true|\WP_Error
	 */
	public function check_selection( $selection ) {
		$source = $this->selected_source( $selection );
		return is_wp_error( $source ) ? $source : true;
	}

	/**
	 * A week's occurrences, both flat and grouped by day.
	 *
	 * @param array{start: string, end: string} $week        Site-local 'Y-m-d' week boundaries.
	 * @param array[]                           $occurrences Occurrence DTOs from EventFeedProvider.
	 * @return array{week: array{start: string, end: string}, occurrences: array[], days: array[]}
	 *     `occurrences` in display order, without drafts. `days` has one entry
	 *     per day of the week, each with date, weekday, day_num, month_name and
	 *     the events on that day (multi-day events on each of their days).
	 */
	public static function week_data( array $week, array $occurrences ) {
		$occurrences = array_values(
			array_filter(
				$occurrences,
				static function ( $occurrence ) {
					return empty( $occurrence['is_draft'] );
				}
			)
		);

		$tz                  = new \DateTimeZone( wp_timezone_string() );
		$occurrences_by_date = EventFeedProvider::group_by_day( $occurrences, $week['start'] . ' 00:00:00', $week['end'] . ' 23:59:59' );
		$days                = array();
		$date                = $week['start'];

		while ( $date <= $week['end'] ) {
			// Midnight in the site timezone, so wp_date() names the same
			// calendar day whatever the site's UTC offset.
			$timestamp = DateHelper::local_to_datetime( $date . ' 00:00:00' )->getTimestamp();
			$days[]    = array(
				'date'       => $date,
				'weekday'    => wp_date( 'l', $timestamp ),
				'day_num'    => (int) substr( $date, 8, 2 ),
				'month_name' => wp_date( 'F', $timestamp ),
				'events'     => array_map(
					static function ( $occurrence ) use ( $tz ) {
						return self::format_day_event( $occurrence, $tz );
					},
					$occurrences_by_date[ $date ] ?? array()
				),
			);
			$date      = DateHelper::next_date( $date );
		}

		return array(
			'week'        => array(
				'start' => $week['start'],
				'end'   => $week['end'],
			),
			'occurrences' => $occurrences,
			'days'        => $days,
		);
	}

	/**
	 * The event source a selection names.
	 *
	 * @param string $selection {@see self::LOCAL_EVENTS} or an event source slug.
	 * @return array|null|\WP_Error The enabled source, null for local events, or an error.
	 */
	private function selected_source( $selection ) {
		if ( self::LOCAL_EVENTS === $selection ) {
			return null;
		}
		if ( ! is_string( $selection ) || '' === $selection || sanitize_title( $selection ) !== $selection ) {
			return new \WP_Error( 'missing_selection', __( 'Choose which events to include.', 'fair-events' ) );
		}

		$source = ( new EventSourceRepository() )->get_by_slug( $selection );
		if ( ! $source || empty( $source['enabled'] ) ) {
			return new \WP_Error( 'invalid_source', __( 'The selected event feed does not exist or is disabled.', 'fair-events' ) );
		}

		return $source;
	}

	/**
	 * Parse ISO week string (e.g., "2026-W07").
	 *
	 * @param string|null $iso_week ISO week string.
	 * @return array|null Array with 'year' and 'week', or null.
	 */
	public function parse_iso_week( $iso_week ) {
		if ( ! $iso_week || ! preg_match( '/^(\d{4})-W(\d{2})$/', $iso_week, $matches ) ) {
			return null;
		}

		$year = (int) $matches[1];
		$week = (int) $matches[2];

		if ( $year < 1900 || $year > 2100 || $week < 1 || $week > 53 ) {
			return null;
		}

		return array(
			'year' => $year,
			'week' => $week,
		);
	}

	/**
	 * Map an EventFeedProvider occurrence DTO to the digest's day-event shape.
	 *
	 * @param array         $occurrence Occurrence DTO from EventFeedProvider (with
	 *                                  is_first_day/is_last_day added by group_by_day()).
	 * @param \DateTimeZone $tz         Site timezone, for resolving end_weekday.
	 * @return array Day-event shape: title, start_time, end_time, url, all_day,
	 *               event_id, event_date_id, end_date, end_weekday.
	 */
	private static function format_day_event( $occurrence, $tz ) {
		$start_date = DateHelper::local_date( $occurrence['start'] );
		$end_date   = ! empty( $occurrence['end'] ) ? DateHelper::local_date( $occurrence['end'] ) : $start_date;
		$is_all_day = (bool) $occurrence['all_day'];

		$end_weekday = null;
		if ( $end_date !== $start_date ) {
			$end_dt      = new \DateTime( $end_date, $tz );
			$end_weekday = wp_date( 'l', $end_dt->getTimestamp() );
		}

		return array(
			'title'         => $occurrence['title'],
			'start_time'    => $is_all_day ? '' : DateHelper::local_time( $occurrence['start'] ),
			'end_time'      => ( $is_all_day || empty( $occurrence['end'] ) ) ? '' : DateHelper::local_time( $occurrence['end'] ),
			'url'           => $occurrence['url'] ?? '',
			'all_day'       => $is_all_day,
			'event_id'      => $occurrence['event_id'] ?? null,
			'event_date_id' => $occurrence['event_date_id'] ?? null,
			'end_date'      => $end_date !== $start_date ? $end_date : null,
			'end_weekday'   => $end_weekday,
		);
	}
}
