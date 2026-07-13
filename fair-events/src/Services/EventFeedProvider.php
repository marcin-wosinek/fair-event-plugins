<?php
/**
 * Event Feed Provider
 *
 * Single pipeline for assembling occurrence DTOs for a date range, merging
 * the local (post-linked + standalone) and external (iCal/Fair Events API)
 * streams. See https://github.com/marcin-wosinek/fair-event-plugins/issues/1093.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Database\EventSourceRepository;
use FairEvents\Helpers\DateHelper;
use FairEvents\Helpers\FairEventsApiParser;
use FairEvents\Helpers\ICalParser;
use FairEvents\Models\EventDates;
use FairEvents\Settings\Settings;

defined( 'WPINC' ) || die;

/**
 * Assembles normalized occurrence DTOs for a date range.
 *
 * DTO shape: uid, event_date_id, event_id, occurrence_type, title,
 * description, start, end, all_day, url, categories, source
 * ('post'|'standalone'|'ical'|'api'), is_draft, source_color.
 *
 * `start`/`end` are naive site-local 'Y-m-d H:i:s' strings — the same form
 * every other internal consumer (EventDates, WeeklyEventsProvider, blocks)
 * already uses. Callers that need ISO 8601 (the public REST feed) convert
 * at their own boundary via DateHelper::local_to_iso8601().
 */
class EventFeedProvider {

	/**
	 * Get normalized occurrence DTOs for a date range, sorted by start.
	 *
	 * @param string $start   Range start, naive 'Y-m-d H:i:s' site-local.
	 * @param string $end     Range end, naive 'Y-m-d H:i:s' site-local.
	 * @param array  $filters {
	 *     Optional filters.
	 *
	 *     @type int[]  $categories           Category term IDs (OR'd with any
	 *                                        category-type data sources on the
	 *                                        given event sources).
	 *     @type string[] $event_source_slugs Event source slugs whose iCal/API
	 *                                        streams and category filters are
	 *                                        merged in.
	 *     @type bool   $include_drafts       Include draft posts.
	 *     @type bool   $include_all_statuses Include posts of any status
	 *                                        (supersedes include_drafts).
	 * }
	 * @return array[] Flat array of occurrence DTOs, sorted by 'start' ASC.
	 */
	public function get_occurrences( $start, $end, $filters = array() ) {
		$filters = array_merge(
			array(
				'categories'           => array(),
				'event_source_slugs'   => array(),
				'include_drafts'       => false,
				'include_all_statuses' => false,
			),
			$filters
		);

		list( $external_occurrences, $source_category_ids ) = $this->get_external_stream(
			$start,
			$end,
			$filters['event_source_slugs']
		);

		$category_ids = array_values(
			array_unique(
				array_map( 'intval', array_merge( $filters['categories'], $source_category_ids ) )
			)
		);

		$local_occurrences = $this->get_local_stream(
			$start,
			$end,
			$category_ids,
			$filters['include_drafts'],
			$filters['include_all_statuses']
		);

		$occurrences = array_merge( $local_occurrences, $external_occurrences );

		usort(
			$occurrences,
			function ( $a, $b ) {
				return strcmp( $a['start'], $b['start'] );
			}
		);

		return $occurrences;
	}

	/**
	 * Expand a flat occurrence list into per-day buckets over a range,
	 * marking first/last day for multi-day spans and sorting each day by
	 * start time. Used by day-grid consumers (calendar/week blocks); REST
	 * and list consumers use the flat list from get_occurrences() directly.
	 *
	 * @param array[] $occurrences  Flat DTO list, as returned by get_occurrences().
	 * @param string  $range_start  Range start, naive 'Y-m-d H:i:s' or 'Y-m-d'.
	 * @param string  $range_end    Range end, naive 'Y-m-d H:i:s' or 'Y-m-d'.
	 * @return array<string, array[]> Map of 'Y-m-d' => DTOs (each with
	 *                                'is_first_day'/'is_last_day' added),
	 *                                sorted by start time within each day.
	 */
	public static function group_by_day( array $occurrences, $range_start, $range_end ) {
		$range_start_date = DateHelper::local_date( $range_start );
		$range_end_date   = DateHelper::local_date( $range_end );

		$by_day = array();

		foreach ( $occurrences as $occurrence ) {
			$start_date = DateHelper::local_date( $occurrence['start'] );
			$end_date   = ! empty( $occurrence['end'] ) ? DateHelper::local_date( $occurrence['end'] ) : $start_date;

			$loop_date = max( $start_date, $range_start_date );
			$last_date = min( $end_date, $range_end_date );

			while ( $loop_date <= $last_date ) {
				if ( ! isset( $by_day[ $loop_date ] ) ) {
					$by_day[ $loop_date ] = array();
				}

				$by_day[ $loop_date ][] = array_merge(
					$occurrence,
					array(
						'is_first_day' => $loop_date === $start_date,
						'is_last_day'  => $loop_date === $end_date,
					)
				);

				$loop_date = DateHelper::next_date( $loop_date );
			}
		}

		foreach ( $by_day as &$day_occurrences ) {
			usort(
				$day_occurrences,
				function ( $a, $b ) {
					return strcmp( $a['start'], $b['start'] );
				}
			);
		}
		unset( $day_occurrences );

		return $by_day;
	}

	/**
	 * Local stream: post-linked and standalone rows from the fair_event_dates
	 * table, filtered by enabled post types, post status, and categories.
	 *
	 * @param string $start                 Range start, naive site-local.
	 * @param string $end                   Range end, naive site-local.
	 * @param int[]  $category_ids          Category term IDs to filter by (empty = no filter).
	 * @param bool   $include_drafts        Include draft posts.
	 * @param bool   $include_all_statuses  Include posts of any status.
	 * @return array[] Occurrence DTOs.
	 */
	private function get_local_stream( $start, $end, $category_ids, $include_drafts, $include_all_statuses ) {
		$rows               = EventDates::get_for_date_range( $start, $end );
		$enabled_post_types = Settings::get_enabled_post_types();
		$site_host          = wp_parse_url( get_site_url(), PHP_URL_HOST );

		$occurrences = array();

		foreach ( $rows as $row ) {
			$resolved_event_id = $row->get_resolved_event_id();

			if ( $resolved_event_id ) {
				$occurrence = $this->format_post_occurrence(
					$row,
					$resolved_event_id,
					$enabled_post_types,
					$include_drafts,
					$include_all_statuses,
					$category_ids,
					$site_host
				);
			} else {
				$occurrence = $this->format_standalone_occurrence( $row, $category_ids, $site_host );
			}

			if ( null !== $occurrence ) {
				$occurrences[] = $occurrence;
			}
		}

		return $occurrences;
	}

	/**
	 * Build a DTO for a post-linked row, or null if it's filtered out.
	 *
	 * @param EventDates $row                   Event date row.
	 * @param int        $event_id              Resolved linked post ID.
	 * @param string[]   $enabled_post_types    Post types eligible for the feed.
	 * @param bool       $include_drafts        Include draft posts.
	 * @param bool       $include_all_statuses  Include posts of any status.
	 * @param int[]      $category_ids          Category term IDs to filter by.
	 * @param string     $site_host             Host for uid construction.
	 * @return array|null Occurrence DTO, or null if filtered out.
	 */
	private function format_post_occurrence( EventDates $row, $event_id, $enabled_post_types, $include_drafts, $include_all_statuses, $category_ids, $site_host ) {
		$post = get_post( $event_id );

		if ( ! $post || ! in_array( $post->post_type, $enabled_post_types, true ) ) {
			return null;
		}

		$is_draft = 'publish' !== $post->post_status;

		if ( $is_draft && ! $include_drafts && ! $include_all_statuses ) {
			return null;
		}

		$post_category_ids = wp_get_post_terms( $event_id, 'category', array( 'fields' => 'ids' ) );
		if ( is_wp_error( $post_category_ids ) ) {
			$post_category_ids = array();
		}

		if ( ! empty( $category_ids ) && empty( array_intersect( $post_category_ids, $category_ids ) ) ) {
			return null;
		}

		$description = '';
		if ( has_excerpt( $event_id ) ) {
			$description = get_the_excerpt( $event_id );
		} elseif ( $post->post_content ) {
			$description = wp_trim_words( wp_strip_all_tags( $post->post_content ), 30 );
		}

		return array(
			'uid'             => 'fair_event_' . $event_id . '_' . $row->id . '@' . $site_host,
			'event_date_id'   => (int) $row->id,
			'event_id'        => (int) $event_id,
			'occurrence_type' => $row->occurrence_type,
			'title'           => $row->get_display_title(),
			'description'     => $description,
			'start'           => $row->start_datetime,
			'end'             => $row->end_datetime ? $row->end_datetime : $row->start_datetime,
			'all_day'         => (bool) $row->all_day,
			'url'             => $row->get_display_url(),
			'categories'      => $this->get_category_objects( $post_category_ids ),
			'source'          => 'post',
			'is_draft'        => $is_draft,
			'source_color'    => null,
		);
	}

	/**
	 * Build a DTO for a standalone row, or null if it's filtered out.
	 *
	 * @param EventDates $row          Event date row.
	 * @param int[]      $category_ids Category term IDs to filter by.
	 * @param string     $site_host    Host for uid construction.
	 * @return array|null Occurrence DTO, or null if filtered out.
	 */
	private function format_standalone_occurrence( EventDates $row, $category_ids, $site_host ) {
		$row_category_ids = EventDates::get_category_ids( $row->id );

		if ( ! empty( $category_ids ) && empty( array_intersect( $row_category_ids, $category_ids ) ) ) {
			return null;
		}

		return array(
			'uid'             => 'standalone_' . $row->id . '@' . $site_host,
			'event_date_id'   => (int) $row->id,
			'event_id'        => null,
			'occurrence_type' => $row->occurrence_type,
			'title'           => $row->get_display_title(),
			'description'     => '',
			'start'           => $row->start_datetime,
			'end'             => $row->end_datetime ? $row->end_datetime : $row->start_datetime,
			'all_day'         => (bool) $row->all_day,
			'url'             => $row->get_display_url(),
			'categories'      => $this->get_category_objects( $row_category_ids ),
			'source'          => 'standalone',
			'is_draft'        => false,
			'source_color'    => null,
		);
	}

	/**
	 * Resolve term IDs to {id, name, slug} objects, dropping any that no
	 * longer exist.
	 *
	 * @param int[] $term_ids Category term IDs.
	 * @return array[] Array of ['id','name','slug'].
	 */
	private function get_category_objects( $term_ids ) {
		$categories = array();

		foreach ( $term_ids as $term_id ) {
			$term = get_term( (int) $term_id, 'category' );
			if ( $term && ! is_wp_error( $term ) ) {
				$categories[] = array(
					'id'   => $term->term_id,
					'name' => $term->name,
					'slug' => $term->slug,
				);
			}
		}

		return $categories;
	}

	/**
	 * External stream: iCal/Fair Events API events from the given event
	 * sources' data sources, plus any category filter contributed by their
	 * 'categories' data sources (merged into the local stream's filter by
	 * the caller — local events are always included; categories, when
	 * configured, only narrow them, mirroring the pre-#1093 behavior).
	 *
	 * @param string   $start               Range start, naive site-local.
	 * @param string   $end                 Range end, naive site-local.
	 * @param string[] $event_source_slugs  Event source slugs.
	 * @return array{0: array[], 1: int[]} [occurrence DTOs, merged category term IDs].
	 */
	private function get_external_stream( $start, $end, $event_source_slugs ) {
		$occurrences  = array();
		$category_ids = array();

		if ( empty( $event_source_slugs ) ) {
			return array( $occurrences, $category_ids );
		}

		$repository = new EventSourceRepository();

		foreach ( $event_source_slugs as $slug ) {
			if ( ! is_string( $slug ) ) {
				continue;
			}

			$source = $repository->get_by_slug( $slug );

			if ( ! $source || ! $source['enabled'] ) {
				continue;
			}

			foreach ( $source['data_sources'] as $data_source ) {
				$type = $data_source['source_type'] ?? '';

				if ( 'ical_url' === $type ) {
					$url = $data_source['config']['url'] ?? '';
					if ( empty( $url ) ) {
						continue;
					}

					$color    = $data_source['config']['color'] ?? '#4caf50';
					$fetched  = ICalParser::fetch_and_parse( $url );
					$filtered = ICalParser::filter_events_for_month( $fetched, $start, $end );

					foreach ( $filtered as $event ) {
						$occurrences[] = $this->format_external_occurrence( $event, 'ical', $color );
					}
				} elseif ( 'fair_events_api' === $type ) {
					$url = $data_source['config']['url'] ?? '';
					if ( empty( $url ) ) {
						continue;
					}

					$color     = $data_source['config']['color'] ?? '#4caf50';
					$api_start = DateHelper::local_date( $start );
					$api_end   = DateHelper::local_date( $end );
					$fetched   = FairEventsApiParser::fetch_and_parse( $url, $api_start, $api_end );
					$filtered  = FairEventsApiParser::filter_events_for_month( $fetched, $start, $end );

					foreach ( $filtered as $event ) {
						$occurrences[] = $this->format_external_occurrence( $event, 'api', $color );
					}
				} elseif ( 'categories' === $type ) {
					$ids = $data_source['config']['category_ids'] ?? array();
					if ( ! empty( $ids ) ) {
						$category_ids = array_merge( $category_ids, $ids );
					}
				}
			}
		}

		return array( $occurrences, array_unique( array_map( 'intval', $category_ids ) ) );
	}

	/**
	 * Build a DTO for an external (iCal/API) event.
	 *
	 * @param array  $event  Event data from ICalParser or FairEventsApiParser.
	 * @param string $source 'ical' or 'api'.
	 * @param string $color  Source color (hex).
	 * @return array Occurrence DTO.
	 */
	private function format_external_occurrence( array $event, $source, $color ) {
		$start = $event['start'] ?? '';
		$end   = ! empty( $event['end'] ) ? $event['end'] : $start;

		return array(
			'uid'             => $event['uid'] ?? md5( $start . ( $event['summary'] ?? '' ) ),
			'event_date_id'   => null,
			'event_id'        => null,
			'occurrence_type' => 'external',
			'title'           => $event['summary'] ?? '',
			'description'     => $event['description'] ?? '',
			'start'           => $start,
			'end'             => $end,
			'all_day'         => (bool) ( $event['all_day'] ?? false ),
			'url'             => $event['url'] ?? '',
			'categories'      => array(),
			'source'          => $source,
			'is_draft'        => false,
			'source_color'    => $color,
		);
	}
}
