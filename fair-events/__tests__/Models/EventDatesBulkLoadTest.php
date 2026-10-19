<?php
/**
 * Bulk loading for listing pipelines: EventDates::prime_master_cache(),
 * get_category_ids_for_rows(), preload_linked_post_ids(), Venue::get_by_ids()
 * and EventLocation::resolve()'s preloaded venues.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Models;

// phpcs:disable Generic.Files.OneObjectStructurePerFile.MultipleFound
// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\EventLocation;
use FairEvents\Models\EventDates;
use FairEvents\Models\Venue;
use ReflectionProperty;

/**
 * $wpdb double answering `id IN (...)` / `event_date_id IN (...)` reads from
 * seeded tables, and recording every query and write.
 */
class Bulk_Load_Test_WPDB {

	/**
	 * Table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Seeded rows per table.
	 *
	 * @var array<string, object[]>
	 */
	public $tables = array();

	/**
	 * Queries run through get_results()/get_row()/get_col(), in order.
	 *
	 * @var string[]
	 */
	public $queries = array();

	/**
	 * Writes (insert/update/delete), in order.
	 *
	 * @var string[]
	 */
	public $writes = array();

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
	 * Resolve an IN-list read: rows of the table whose `id` (or, for
	 * `event_date_id IN`, `event_date_id`) is listed.
	 *
	 * @param array $prepared Value returned by prepare().
	 * @return object[]
	 */
	public function get_results( $prepared ) {
		$this->queries[] = $prepared['query'];

		$table  = $prepared['args'][0];
		$ids    = array_map( 'intval', array_slice( $prepared['args'], 1 ) );
		$column = str_contains( $prepared['query'], 'event_date_id IN' ) ? 'event_date_id' : 'id';

		return array_values(
			array_filter(
				$this->tables[ $table ] ?? array(),
				static function ( $row ) use ( $column, $ids ) {
					return in_array( (int) $row->$column, $ids, true );
				}
			)
		);
	}

	/**
	 * Single-row reads are recorded and never resolve.
	 *
	 * @param array $prepared Value returned by prepare().
	 * @return null
	 */
	public function get_row( $prepared ) {
		$this->queries[] = $prepared['query'];
		return null;
	}

	/**
	 * Column reads are recorded and never resolve.
	 *
	 * @param array $prepared Value returned by prepare().
	 * @return array
	 */
	public function get_col( $prepared ) {
		$this->queries[] = $prepared['query'];
		return array();
	}

	/**
	 * Record an insert.
	 *
	 * @param string $table Table.
	 * @return int
	 */
	public function insert( $table ) {
		$this->writes[] = 'insert ' . $table;
		return 1;
	}

	/**
	 * Record an update.
	 *
	 * @param string $table Table.
	 * @return int
	 */
	public function update( $table ) {
		$this->writes[] = 'update ' . $table;
		return 1;
	}

	/**
	 * Record a delete.
	 *
	 * @param string $table Table.
	 * @return int
	 */
	public function delete( $table ) {
		$this->writes[] = 'delete ' . $table;
		return 1;
	}
}

/**
 * Tests for the bulk loaders behind EventFeedProvider.
 */
class EventDatesBulkLoadTest extends TestCase {

	/**
	 * The bootstrap's $wpdb, restored after each test.
	 *
	 * @var object
	 */
	private $original_wpdb;

	/**
	 * The test double.
	 *
	 * @var Bulk_Load_Test_WPDB
	 */
	private $wpdb;

	/**
	 * Install the double and reset the master cache.
	 */
	protected function setUp(): void {
		parent::setUp();

		$this->original_wpdb = $GLOBALS['wpdb'];
		$this->wpdb          = new Bulk_Load_Test_WPDB();
		$GLOBALS['wpdb']     = $this->wpdb;

		$this->set_master_cache( array() );
		$GLOBALS['_fair_test_post_terms']          = array();
		$GLOBALS['_fair_test_get_the_terms_calls'] = array();
	}

	/**
	 * Restore the bootstrap's $wpdb and empty the master cache.
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->original_wpdb;
		$this->set_master_cache( array() );

		parent::tearDown();
	}

	/**
	 * Replace EventDates::$master_cache.
	 *
	 * @param array $value Cache contents.
	 * @return void
	 */
	private function set_master_cache( array $value ) {
		$property = new ReflectionProperty( EventDates::class, 'master_cache' );
		$property->setValue( null, $value );
	}

	/**
	 * Build a raw fair_event_dates row.
	 *
	 * @param int   $id        Row ID.
	 * @param array $overrides Column overrides.
	 * @return object
	 */
	private function date_row( $id, array $overrides = array() ) {
		return (object) array_merge(
			array(
				'id'                       => $id,
				'event_id'                 => null,
				'category_selection_saved' => 0,
				'start_date'               => '2031-03-10',
				'end_date'                 => '2031-03-10',
				'start_time'               => '10:00:00',
				'end_time'                 => '11:00:00',
				'all_day'                  => 0,
				'occurrence_type'          => 'single',
				'master_id'                => null,
			),
			$overrides
		);
	}

	/**
	 * Hydrate a row the way list queries do, with its master already cached.
	 *
	 * @param object $row Raw row.
	 * @return EventDates
	 */
	private function hydrate( $row ) {
		$method = new \ReflectionMethod( EventDates::class, 'hydrate' );
		return $method->invoke( null, $row );
	}

	/**
	 * Seed category relationships.
	 *
	 * @param array<int, int[]> $by_date Term IDs keyed by event date ID.
	 * @return void
	 */
	private function seed_categories( array $by_date ) {
		foreach ( $by_date as $event_date_id => $term_ids ) {
			foreach ( $term_ids as $term_id ) {
				$this->wpdb->tables['wp_fair_event_date_categories'][] = (object) array(
					'event_date_id' => $event_date_id,
					'term_id'       => $term_id,
				);
			}
		}
	}

	/**
	 * Masters are loaded with one query; a missing master is remembered as
	 * missing instead of being looked up again.
	 */
	public function test_prime_master_cache_loads_masters_once() {
		$this->wpdb->tables['wp_fair_event_dates'] = array( $this->date_row( 1, array( 'occurrence_type' => 'master' ) ) );

		EventDates::prime_master_cache( array( 1, 2, null, 1 ) );
		EventDates::prime_master_cache( array( 1, 2 ) );

		$this->assertCount( 1, $this->wpdb->queries );

		$cache = ( new ReflectionProperty( EventDates::class, 'master_cache' ) )->getValue();
		$this->assertSame( 1, $cache[1]->id );
		$this->assertArrayHasKey( 2, $cache );
		$this->assertNull( $cache[2] );
	}

	/**
	 * Every rule of get_category_ids() is followed for a mixed set of rows,
	 * with one query for all their categories, and nothing written.
	 */
	public function test_category_ids_for_rows_follow_get_category_ids_rules() {
		$this->wpdb->tables['wp_fair_event_dates'] = array(
			$this->date_row(
				10,
				array(
					'occurrence_type'          => 'master',
					'category_selection_saved' => 1,
				)
			),
			$this->date_row(
				20,
				array(
					'occurrence_type' => 'master',
					'event_id'        => 42,
				)
			),
		);
		$this->seed_categories(
			array(
				2  => array( 7 ),
				4  => array( 9 ),
				10 => array( 5 ),
			)
		);
		$GLOBALS['_fair_test_post_terms'][42]['category'] = array( 3, 4 );
		$GLOBALS['_fair_test_post_terms'][43]['category'] = array( 8 );

		$rows = array(
			// Explicitly saved empty selection: stays empty.
			$this->date_row(
				1,
				array(
					'category_selection_saved' => 1,
					'event_id'                 => 43,
				)
			),
			// Unsaved, but has categories of its own.
			$this->date_row( 2, array( 'event_id' => 43 ) ),
			// Instance inheriting its master's saved selection.
			$this->date_row(
				3,
				array(
					'occurrence_type' => 'generated',
					'master_id'       => 10,
				)
			),
			// Instance with its own selection.
			$this->date_row(
				4,
				array(
					'occurrence_type' => 'generated',
					'master_id'       => 10,
				)
			),
			// Instance of a legacy master: falls back to the master's post.
			$this->date_row(
				5,
				array(
					'occurrence_type' => 'generated',
					'master_id'       => 20,
				)
			),
			// Legacy single row: falls back to its post.
			$this->date_row( 6, array( 'event_id' => 43 ) ),
			// Standalone row without categories.
			$this->date_row( 7 ),
			// Instance whose master no longer exists.
			$this->date_row(
				8,
				array(
					'occurrence_type' => 'generated',
					'master_id'       => 99,
				)
			),
		);

		// As in get_for_date_range(): masters are primed before hydrating.
		EventDates::prime_master_cache( array_column( $rows, 'master_id' ) );
		$this->wpdb->queries = array();

		$category_ids = EventDates::get_category_ids_for_rows( array_map( array( $this, 'hydrate' ), $rows ) );

		$this->assertSame(
			array(
				1 => array(),
				2 => array( 7 ),
				3 => array( 5 ),
				4 => array( 9 ),
				5 => array( 3, 4 ),
				6 => array( 8 ),
				7 => array(),
				8 => array(),
			),
			$category_ids
		);
		$this->assertCount( 1, $this->wpdb->queries );
		$this->assertSame( array(), $this->wpdb->writes );
	}

	/**
	 * Linked posts are loaded for all rows with one query; a generated row
	 * reads its master's links, and a row without links resolves to none
	 * without a query of its own.
	 */
	public function test_preload_linked_post_ids_serves_primary_linked_post() {
		$this->wpdb->tables['wp_fair_event_date_posts'] = array(
			(object) array(
				'event_date_id' => 10,
				'post_id'       => 30,
			),
			(object) array(
				'event_date_id' => 10,
				'post_id'       => 31,
			),
		);
		$this->set_master_cache( array( 10 => $this->hydrate( $this->date_row( 10, array( 'occurrence_type' => 'master' ) ) ) ) );

		$master    = $this->hydrate( $this->date_row( 10, array( 'occurrence_type' => 'master' ) ) );
		$instance  = $this->hydrate(
			$this->date_row(
				11,
				array(
					'occurrence_type' => 'generated',
					'master_id'       => 10,
				)
			)
		);
		$unlinked  = $this->hydrate( $this->date_row( 12 ) );
		$rows      = array( $master, $instance, $unlinked );
		$query_log = count( $this->wpdb->queries );

		EventDates::preload_linked_post_ids( $rows );

		$this->assertSame( 30, $master->get_primary_linked_post_id() );
		$this->assertSame( 30, $instance->get_primary_linked_post_id() );
		$this->assertNull( $unlinked->get_primary_linked_post_id() );
		$this->assertCount( $query_log + 1, $this->wpdb->queries );
	}

	/**
	 * Venues come back keyed by every requested ID, null when missing.
	 */
	public function test_venue_get_by_ids_keys_every_requested_id() {
		$this->wpdb->tables['wp_fair_event_venues'] = array(
			(object) array(
				'id'                 => 3,
				'name'               => 'Hall',
				'address'            => 'Main St 1',
				'latitude'           => null,
				'longitude'          => null,
				'facebook_page_link' => null,
				'created_at'         => '2031-01-01 00:00:00',
				'updated_at'         => '2031-01-01 00:00:00',
			),
		);

		$venues = Venue::get_by_ids( array( 3, 4, 3, 0 ) );

		$this->assertSame( array( 3, 4 ), array_keys( $venues ) );
		$this->assertSame( 'Hall', $venues[3]->name );
		$this->assertNull( $venues[4] );
		$this->assertCount( 1, $this->wpdb->queries );
	}

	/**
	 * A preloaded venue map is used instead of a lookup, and a venue known
	 * to be missing falls through to the row's own address.
	 */
	public function test_location_uses_preloaded_venues() {
		$venue          = new Venue();
		$venue->id      = 3;
		$venue->name    = 'Hall';
		$venue->address = 'Main St 1';

		$with_venue           = new EventDates();
		$with_venue->venue_id = 3;

		$missing_venue           = new EventDates();
		$missing_venue->venue_id = 4;
		$missing_venue->address  = 'Fallback 2';

		$venues = array(
			3 => $venue,
			4 => null,
		);

		$this->assertSame(
			array(
				'mode'    => 'in_person',
				'name'    => 'Hall',
				'address' => 'Main St 1',
			),
			EventLocation::resolve( $with_venue, null, $venues )
		);
		$this->assertSame(
			array(
				'mode'    => 'in_person',
				'address' => 'Fallback 2',
			),
			EventLocation::resolve( $missing_venue, null, $venues )
		);
		$this->assertSame( array(), $this->wpdb->queries );
	}
}
