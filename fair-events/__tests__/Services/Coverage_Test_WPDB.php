<?php
/**
 * $wpdb double for series coverage and batch capacity tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

/**
 * Answers the event date reads and admission counts behind
 * SeriesCoverage::for_event_date() from seeded rows, and records every
 * query so tests can tell date reads from admission counts.
 */
class Coverage_Test_WPDB {

	/**
	 * Table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Seeded fair_event_dates rows, keyed by ID.
	 *
	 * @var array<int, object>
	 */
	public $dates = array();

	/**
	 * Confirmed ticket units per event date ID.
	 *
	 * @var array<int, int>
	 */
	public $taken = array();

	/**
	 * Queries run, in order.
	 *
	 * @var string[]
	 */
	public $queries = array();

	/**
	 * Seed a weekly series: the master and its generated occurrences.
	 *
	 * @param int      $master_id First ID; occurrences follow it.
	 * @param int      $count     Dates in the series, master included.
	 * @param int|null $capacity  Master capacity, inherited by occurrences.
	 * @return int[] Series IDs in date order.
	 */
	public function seed_series( $master_id, $count, $capacity = null ) {
		$ids = array();
		for ( $i = 0; $i < $count; $i++ ) {
			$id    = $master_id + $i;
			$date  = gmdate( 'Y-m-d', strtotime( '2031-03-01 +' . ( 7 * $i ) . ' days' ) );
			$ids[] = $id;

			$this->dates[ $id ] = (object) array(
				'id'                       => $id,
				'event_id'                 => 0 === $i ? 900 : null,
				'category_selection_saved' => 0,
				'start_date'               => $date,
				'end_date'                 => $date,
				'start_time'               => '10:00:00',
				'end_time'                 => '11:00:00',
				'all_day'                  => 0,
				'occurrence_type'          => 0 === $i ? 'master' : 'generated',
				'master_id'                => 0 === $i ? null : $master_id,
				'status'                   => 'active',
				'capacity'                 => 0 === $i ? $capacity : null,
			);
		}

		return $ids;
	}

	/**
	 * Queries that read one event date row by ID (EventDates::get_by_id()).
	 *
	 * @return string[]
	 */
	public function single_date_reads() {
		return array_values(
			array_filter(
				$this->queries,
				static function ( $query ) {
					return 'SELECT * FROM %i WHERE id = %d LIMIT 1' === $query;
				}
			)
		);
	}

	/**
	 * Queries that count admissions (ticket units and unbackfilled signups).
	 *
	 * @return string[]
	 */
	public function admission_counts() {
		return array_values(
			array_filter(
				$this->queries,
				static function ( $query ) {
					return 0 === strpos( $query, 'SELECT COUNT(*)' ) || 0 === strpos( $query, 'SELECT COALESCE( SUM' );
				}
			)
		);
	}

	/**
	 * Capture the query and its arguments.
	 *
	 * @param string $query   Query.
	 * @param mixed  ...$args Arguments, or one array of them.
	 * @return array{query: string, args: array}
	 */
	public function prepare( $query, ...$args ) {
		if ( 1 === count( $args ) && is_array( $args[0] ) ) {
			$args = $args[0];
		}

		return array(
			'query' => $query,
			'args'  => $args,
		);
	}

	/**
	 * Resolve an `id IN (...)` read.
	 *
	 * @param array $prepared Value returned by prepare().
	 * @return object[]
	 */
	public function get_results( $prepared ) {
		$this->queries[] = $prepared['query'];

		$ids = array_map( 'intval', array_slice( $prepared['args'], 1 ) );

		return array_values(
			array_filter(
				$this->dates,
				static function ( $row ) use ( $ids ) {
					return in_array( (int) $row->id, $ids, true );
				}
			)
		);
	}

	/**
	 * Resolve a read of one event date row by ID.
	 *
	 * @param array $prepared Value returned by prepare().
	 * @return object|null
	 */
	public function get_row( $prepared ) {
		$this->queries[] = $prepared['query'];

		$row = $this->dates[ (int) $prepared['args'][1] ] ?? null;

		return $row ? clone $row : null;
	}

	/**
	 * Resolve the series ID reads: the series, or its active dates.
	 *
	 * @param array $prepared Value returned by prepare().
	 * @return int[]
	 */
	public function get_col( $prepared ) {
		$this->queries[] = $prepared['query'];

		$master_id = (int) $prepared['args'][1];
		$ids       = array();
		foreach ( $this->dates as $row ) {
			if ( (int) $row->id === $master_id || ( 'generated' === $row->occurrence_type && (int) $row->master_id === $master_id ) ) {
				$ids[] = (int) $row->id;
			}
		}
		sort( $ids );

		return $ids;
	}

	/**
	 * Resolve an admission count: units are the seeded taken places, and no
	 * signup is left unbackfilled.
	 *
	 * @param array $prepared Value returned by prepare().
	 * @return int
	 */
	public function get_var( $prepared ) {
		$this->queries[] = $prepared['query'];

		if ( 0 !== strpos( $prepared['query'], 'SELECT COUNT(*)' ) ) {
			return 0;
		}

		// The series form of the count passes the date after three tables
		// and the current time; the single-date form after two tables.
		$in_series     = false !== strpos( $prepared['query'], 'LEFT JOIN' );
		$event_date_id = (int) $prepared['args'][ $in_series ? 4 : 2 ];

		return $this->taken[ $event_date_id ] ?? 0;
	}
}
