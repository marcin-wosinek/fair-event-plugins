<?php
/**
 * OfferCapacity tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

// The double extends the shared series double in the same file.
// phpcs:disable Generic.Files.OneObjectStructurePerFile.MultipleFound

use FairEvents\Models\EventDates;
use FairEvents\Services\OfferCapacity;
use PHPUnit\Framework\TestCase;
use ReflectionProperty;

require_once __DIR__ . '/Coverage_Test_WPDB.php';

/**
 * Adds ticket-type and extension counts to the series double.
 */
class Offer_Capacity_Test_WPDB extends Coverage_Test_WPDB {

	/**
	 * Confirmed tickets per ticket type ID.
	 *
	 * @var array<int, int>
	 */
	public $type_taken = array();

	/**
	 * Active selections, by option ID then event date ID.
	 *
	 * @var array<int, array<int, int>>
	 */
	public $option_taken = array();

	/**
	 * Resolve ticket-type and extension counts; defer the rest.
	 *
	 * @param array $prepared Value returned by prepare().
	 * @return int
	 */
	public function get_var( $prepared ) {
		$query = $prepared['query'];

		if ( false !== strpos( $query, 'ta.ticket_option_id' ) ) {
			$this->queries[] = $query;
			$in_series       = false !== strpos( $query, 'LEFT JOIN' );
			$option_id       = (int) $prepared['args'][ $in_series ? 4 : 3 ];
			$event_date_id   = (int) $prepared['args'][ $in_series ? 7 : 4 ];

			return $this->option_taken[ $option_id ][ $event_date_id ] ?? 0;
		}

		if ( false !== strpos( $query, 't.ticket_type_id = %d' ) ) {
			$this->queries[] = $query;

			return $this->type_taken[ (int) $prepared['args'][2] ] ?? 0;
		}

		return parent::get_var( $prepared );
	}

	/**
	 * Queries that count a ticket type's or an extension's places.
	 *
	 * @param string $needle Fragment identifying the count.
	 * @return string[]
	 */
	public function counts_matching( $needle ) {
		return array_values(
			array_filter(
				$this->queries,
				static function ( $query ) use ( $needle ) {
					return false !== strpos( $query, $needle );
				}
			)
		);
	}
}

/**
 * Whether one more ticket can be bought, as structured data reports it
 * (#2082).
 */
class OfferCapacityTest extends TestCase {

	/**
	 * The bootstrap's $wpdb, restored after each test.
	 *
	 * @var object
	 */
	private $original_wpdb;

	/**
	 * The test double.
	 *
	 * @var Offer_Capacity_Test_WPDB
	 */
	private $wpdb;

	/**
	 * Install the double and empty the master cache.
	 */
	protected function setUp(): void {
		parent::setUp();

		$this->original_wpdb = $GLOBALS['wpdb'];
		$this->wpdb          = new Offer_Capacity_Test_WPDB();
		$GLOBALS['wpdb']     = $this->wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- swapped for the test double, restored in tearDown().
		self::reset_master_cache();
	}

	/**
	 * Restore the bootstrap's $wpdb and empty the master cache.
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->original_wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restores the bootstrap's $wpdb.
		self::reset_master_cache();

		parent::tearDown();
	}

	/**
	 * Empty EventDates' per-request master cache.
	 *
	 * @return void
	 */
	private static function reset_master_cache() {
		$property = new ReflectionProperty( EventDates::class, 'master_cache' );
		$property->setValue( null, array() );
	}

	/**
	 * Build a ticket type stub.
	 *
	 * @param int      $id       Ticket type ID.
	 * @param string   $scope    Recurrence scope.
	 * @param int|null $capacity Places, or null for no limit.
	 * @return object
	 */
	private function type( $id, $scope = 'single_instance', $capacity = null ) {
		return (object) array(
			'id'               => $id,
			'recurrence_scope' => $scope,
			'capacity'         => $capacity,
		);
	}

	/**
	 * Build a configured extension row.
	 *
	 * @param int      $id       Option ID.
	 * @param float    $price    Price.
	 * @param int|null $capacity Places, or null for no limit.
	 * @return array
	 */
	private function extension( $id, $price, $capacity = null ) {
		return array(
			'option' => (object) array(
				'id'       => $id,
				'capacity' => $capacity,
			),
			'price'  => $price,
		);
	}

	/** Unlimited dates and types are never sold out and count nothing. */
	public function test_unlimited_places_are_never_sold_out() {
		$this->wpdb->seed_series( 100, 3 );

		$capacity            = new OfferCapacity( 101 );
		$this->wpdb->queries = array();

		$this->assertSame( array(), $capacity->sold_out_type_ids( array( $this->type( 1 ), $this->type( 2, 'whole_series' ) ) ) );
		$this->assertSame( array(), $this->wpdb->admission_counts() );
	}

	/**
	 * A full occurrence sells out every type taking a place on it; a place
	 * left keeps them on sale.
	 */
	public function test_full_occurrence_sells_out_its_types() {
		$this->wpdb->seed_series( 100, 3, 2 );
		$this->wpdb->taken[101] = 2;

		$types = array( $this->type( 1 ), $this->type( 2, 'multiple_instances' ), $this->type( 3, 'whole_series' ) );

		$this->assertSame( array( 1, 2, 3 ), ( new OfferCapacity( 101 ) )->sold_out_type_ids( $types ) );

		$this->wpdb->taken[101] = 1;
		$this->assertSame( array(), ( new OfferCapacity( 101 ) )->sold_out_type_ids( $types ) );
	}

	/**
	 * A whole-series ticket needs a place on every covered occurrence, so a
	 * later full date sells it out while a single ticket stays on sale.
	 */
	public function test_whole_series_needs_every_covered_date() {
		$this->wpdb->seed_series( 100, 3, 2 );
		$this->wpdb->taken[102] = 2;

		$this->assertSame(
			array( 2 ),
			( new OfferCapacity( 101 ) )->sold_out_type_ids( array( $this->type( 1 ), $this->type( 2, 'whole_series' ) ) )
		);
	}

	/** An exhausted ticket type is sold out; one with a place left is not. */
	public function test_exhausted_ticket_type_is_sold_out() {
		$this->wpdb->seed_series( 100, 1 );
		$this->wpdb->type_taken = array(
			1 => 5,
			2 => 4,
		);

		$this->assertSame(
			array( 1 ),
			( new OfferCapacity( 100 ) )->sold_out_type_ids( array( $this->type( 1, 'single_instance', 5 ), $this->type( 2, 'single_instance', 5 ) ) )
		);
	}

	/** Types sharing an occurrence count its admissions once. */
	public function test_shared_occurrence_is_counted_once() {
		$this->wpdb->seed_series( 100, 3, 4 );

		$capacity            = new OfferCapacity( 101 );
		$this->wpdb->queries = array();
		$capacity->sold_out_type_ids( array( $this->type( 1 ), $this->type( 2 ), $this->type( 3 ) ) );

		// One occurrence: its units and its unbackfilled signups.
		$this->assertCount( 2, $this->wpdb->admission_counts() );
		$this->assertSame( array(), $this->wpdb->counts_matching( 't.ticket_type_id = %d' ) );
	}

	/**
	 * An extension full on the advertised occurrence is unavailable to
	 * every type; one full only on a later date is unavailable to a
	 * whole-series ticket alone.
	 */
	public function test_extension_places_follow_covered_dates() {
		$this->wpdb->seed_series( 100, 3 );
		$this->wpdb->option_taken = array(
			10 => array( 101 => 1 ),
			11 => array( 102 => 1 ),
		);

		$configured = array(
			$this->extension( 10, 4.0, 1 ),
			$this->extension( 11, 6.0, 1 ),
			$this->extension( 12, 9.0 ),
		);
		$capacity   = new OfferCapacity( 101 );

		$this->assertSame( array( 6.0, 9.0 ), $capacity->available_extension_prices( $configured, $this->type( 1 ) ) );
		$this->assertSame( array( 9.0 ), $capacity->available_extension_prices( $configured, $this->type( 2, 'whole_series' ) ) );
	}

	/** Each extension place is counted once per occurrence, whatever the types. */
	public function test_extension_counts_are_reused() {
		$this->wpdb->seed_series( 100, 1 );
		$configured = array( $this->extension( 10, 4.0, 3 ), $this->extension( 11, 6.0 ) );
		$capacity   = new OfferCapacity( 100 );

		$capacity->available_extension_prices( $configured, $this->type( 1 ) );
		$capacity->available_extension_prices( $configured, $this->type( 2 ) );

		$this->assertCount( 1, $this->wpdb->counts_matching( 'ta.ticket_option_id' ) );
	}
}
