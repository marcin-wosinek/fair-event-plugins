<?php
/**
 * Tests for EventSchema::selectable_extension_prices().
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

// The loader needs a small query-routing wpdb double in the same file and
// swaps the WordPress database global for the duration of each test.
// phpcs:disable Generic.Files.OneObjectStructurePerFile.MultipleFound
// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited

use FairEvents\Helpers\EventSchema;
use PHPUnit\Framework\TestCase;

/**
 * Answers the option catalogue, option price, schedule and capacity reads
 * the loader makes, keyed by the event date each one asks about.
 */
class Extension_Prices_WPDB {
	/**
	 * WordPress table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Option rows, keyed by event date ID.
	 *
	 * @var array<int, object[]>
	 */
	public $options = array();

	/**
	 * Option price rows, keyed by event date ID.
	 *
	 * @var array<int, object[]>
	 */
	public $option_prices = array();

	/**
	 * Non-bookable option IDs, keyed by event date ID.
	 *
	 * @var array<int, int[]>
	 */
	public $non_bookable = array();

	/**
	 * Event date rows, keyed by ID.
	 *
	 * @var array<int, object>
	 */
	public $event_dates = array();

	/**
	 * Taken places, keyed by option ID then event date ID.
	 *
	 * @var array<int, array<int, int>>
	 */
	public $taken = array();

	/**
	 * Event date IDs the option catalogue was read for.
	 *
	 * @var int[]
	 */
	public $catalogue_reads = array();

	/**
	 * Capture a prepared query.
	 *
	 * @param string $query   Query template.
	 * @param mixed  ...$args Query arguments.
	 * @return array Prepared query capture.
	 */
	public function prepare( $query, ...$args ) {
		return array(
			'query' => $query,
			'args'  => $args,
		);
	}

	/**
	 * Option catalogue and option price reads.
	 *
	 * @param array $prepared Prepared query capture.
	 * @return object[]
	 */
	public function get_results( $prepared ) {
		if ( str_starts_with( $prepared['query'], 'SELECT p.*' ) ) {
			return $this->option_prices[ (int) $prepared['args'][2] ] ?? array();
		}

		$this->catalogue_reads[] = (int) $prepared['args'][1];
		return $this->options[ (int) $prepared['args'][1] ] ?? array();
	}

	/**
	 * Non-bookable option IDs, and the series of a capacity count (only the
	 * counted date, so the single-date count applies).
	 *
	 * @param array $prepared Prepared query capture.
	 * @return int[]
	 */
	public function get_col( $prepared ) {
		if ( str_contains( $prepared['query'], 'bookable = 0' ) ) {
			return $this->non_bookable[ (int) $prepared['args'][1] ] ?? array();
		}

		return array( (int) $prepared['args'][1] );
	}

	/**
	 * The event date row of a capacity count.
	 *
	 * @param array $prepared Prepared query capture.
	 * @return object|null
	 */
	public function get_row( $prepared ) {
		return $this->event_dates[ (int) $prepared['args'][1] ] ?? null;
	}

	/**
	 * Places taken in an option on one event date.
	 *
	 * @param array $prepared Prepared query capture.
	 * @return string
	 */
	public function get_var( $prepared ) {
		return (string) ( $this->taken[ (int) $prepared['args'][3] ][ (int) $prepared['args'][4] ] ?? 0 );
	}
}

/**
 * Covers which extensions JSON-LD offers can count on, and at what price.
 */
class EventSchemaExtensionPricesTest extends TestCase {

	/**
	 * Database double used by the test.
	 *
	 * @var Extension_Prices_WPDB
	 */
	private $db;

	/**
	 * Install the database double.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->db        = new Extension_Prices_WPDB();
		$GLOBALS['wpdb'] = $this->db;
	}

	/**
	 * Restore the shared database double after each test.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = new \Fair_Test_WPDB();
		parent::tearDown();
	}

	/**
	 * Build a raw ticket option row.
	 *
	 * @param int      $id            Option ID.
	 * @param int      $event_date_id Event date the option belongs to.
	 * @param float    $price         Stored price.
	 * @param bool     $derived       Whether the price comes from the sale period.
	 * @param int|null $capacity      Places, or null for no limit.
	 * @return object Option row.
	 */
	private function option( $id, $event_date_id, $price, $derived = false, $capacity = null ) {
		return (object) array(
			'id'                            => $id,
			'event_date_id'                 => $event_date_id,
			'name'                          => 'Option ' . $id,
			'price'                         => $price,
			'capacity'                      => $capacity,
			'derive_price_from_sale_period' => $derived ? '1' : '0',
			'sort_order'                    => $id,
			'created_at'                    => '2026-01-01 00:00:00',
			'updated_at'                    => '2026-01-01 00:00:00',
		);
	}

	/**
	 * Build a raw option price row.
	 *
	 * @param int   $option_id Option ID.
	 * @param int   $period_id Sale period ID.
	 * @param float $price     Price for that period.
	 * @return object Price row.
	 */
	private function option_price( $option_id, $period_id, $price ) {
		return (object) array(
			'ticket_option_id' => $option_id,
			'sale_period_id'   => $period_id,
			'price'            => $price,
			'created_at'       => '2026-01-01 00:00:00',
			'updated_at'       => '2026-01-01 00:00:00',
		);
	}

	/**
	 * Derived options take the selected period's price (not another
	 * period's), and fixed options keep their stored price.
	 */
	public function test_prices_come_from_selected_period() {
		$this->db->options[1]       = array(
			$this->option( 10, 1, 99.0, true ),
			$this->option( 11, 1, 3.0 ),
		);
		$this->db->option_prices[1] = array(
			$this->option_price( 10, 1, 5.0 ),
			$this->option_price( 10, 2, 9.0 ),
		);

		$this->assertSame( array( 9.0, 3.0 ), EventSchema::selectable_extension_prices( 1, 1, (object) array( 'id' => 2 ) ) );
		$this->assertSame( array( 5.0, 3.0 ), EventSchema::selectable_extension_prices( 1, 1, (object) array( 'id' => 1 ) ) );
	}

	/**
	 * A missing price row makes a derived option unavailable; a stored zero
	 * row keeps it as a free extension.
	 */
	public function test_missing_price_is_unavailable_and_zero_is_free() {
		$this->db->options[1]       = array(
			$this->option( 10, 1, 7.0, true ),
			$this->option( 11, 1, 7.0, true ),
		);
		$this->db->option_prices[1] = array( $this->option_price( 11, 1, 0.0 ) );

		$this->assertSame( array( 0.0 ), EventSchema::selectable_extension_prices( 1, 1, (object) array( 'id' => 1 ) ) );
	}

	/**
	 * Options the event schedule marks as not bookable are left out.
	 */
	public function test_non_bookable_options_are_excluded() {
		$this->db->options[1]      = array(
			$this->option( 10, 1, 4.0 ),
			$this->option( 11, 1, 6.0 ),
		);
		$this->db->non_bookable[1] = array( 10 );

		$this->assertSame( array( 6.0 ), EventSchema::selectable_extension_prices( 1, 1, (object) array( 'id' => 1 ) ) );
	}

	/**
	 * A generated occurrence reads the master's catalogue, but places are
	 * counted on the advertised occurrence.
	 */
	public function test_master_catalogue_with_occurrence_capacity() {
		$this->db->options[1]     = array(
			$this->option( 10, 1, 4.0, false, 2 ),
			$this->option( 11, 1, 6.0, false, 2 ),
		);
		$this->db->event_dates[2] = (object) array(
			'id'              => 2,
			'master_id'       => 1,
			'occurrence_type' => 'generated',
			'all_day'         => '0',
			'start_date'      => '2026-11-10',
			'end_date'        => '2026-11-10',
			'start_time'      => '18:00:00',
			'end_time'        => '20:00:00',
		);
		$this->db->taken          = array(
			10 => array( 2 => 2 ),
			11 => array(
				1 => 2,
				2 => 1,
			),
		);

		$this->assertSame( array( 6.0 ), EventSchema::selectable_extension_prices( 1, 2, (object) array( 'id' => 1 ) ) );
		$this->assertSame( array( 1 ), $this->db->catalogue_reads );
	}
}
