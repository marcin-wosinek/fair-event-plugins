<?php
/**
 * Photo cleanup tests.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Database;

// The cleanup needs a small wpdb double in the same file and swaps the
// WordPress database and hook globals for the duration of each test.
// phpcs:disable Generic.Files.OneObjectStructurePerFile.MultipleFound
// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited

use FairAudience\Database\PhotoCleanup;
use PHPUnit\Framework\TestCase;

/**
 * Tracks tables and user meta, and can fail chosen operations.
 */
class Photo_Cleanup_WPDB {
	/**
	 * WordPress table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * User meta table name.
	 *
	 * @var string
	 */
	public $usermeta = 'wp_usermeta';

	/**
	 * Existing tables, keyed by full name.
	 *
	 * @var array<string, true>
	 */
	public $tables = array();

	/**
	 * Stored user meta rows as [ user_id, meta_key ].
	 *
	 * @var array<int, array{0:int,1:string}>
	 */
	public $user_meta = array();

	/**
	 * Whether DROP TABLE fails.
	 *
	 * @var bool
	 */
	public $fail_drop = false;

	/**
	 * Whether deleting user meta silently leaves the rows in place.
	 *
	 * @var bool
	 */
	public $fail_meta_delete = false;

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
	 * Run a DROP TABLE IF EXISTS against the tracked tables.
	 *
	 * @param array $prepared Prepared query capture.
	 * @return int|false Affected rows, or false on an injected failure.
	 */
	public function query( $prepared ) {
		if ( $this->fail_drop ) {
			return false;
		}
		unset( $this->tables[ $prepared['args'][0] ] );
		return 0;
	}

	/**
	 * Count user meta rows with the given keys.
	 *
	 * @param array $prepared Prepared query capture.
	 * @return string Row count.
	 */
	public function get_var( $prepared ) {
		$keys = array_slice( $prepared['args'], 1 );
		$rows = array_filter(
			$this->user_meta,
			function ( $row ) use ( $keys ) {
				return in_array( $row[1], $keys, true );
			}
		);
		return (string) count( $rows );
	}
}

/**
 * Covers the 1.46.0 photo authorship and upload removal.
 */
class PhotoCleanupTest extends TestCase {

	/**
	 * Database double used by the test.
	 *
	 * @var Photo_Cleanup_WPDB
	 */
	private $db;

	/**
	 * Seed an installation that still has photo data.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->db                      = new Photo_Cleanup_WPDB();
		$this->db->tables              = array(
			'wp_fair_audience_photo_participants' => true,
			'wp_fair_audience_participants'       => true,
		);
		$this->db->user_meta           = array(
			array( 1, 'fair_audience_bulk_upload_author' ),
			array( 1, 'fair_audience_bulk_upload_tags' ),
			array( 2, 'fair_audience_bulk_upload_tags' ),
			array( 2, 'locale' ),
		);
		$GLOBALS['wpdb']               = $this->db;
		$GLOBALS['wp_filter']          = array();
		$GLOBALS['_fair_test_options'] = array(
			'fair_audience_experimental_features' => array(
				'photos' => true,
				'polls'  => false,
			),
		);
	}

	/**
	 * Remove the doubles after each test.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['wpdb'], $GLOBALS['wp_filter'] );
		$GLOBALS['_fair_test_options'] = array();
		parent::tearDown();
	}

	/**
	 * Cleanup drops attribution, preferences and the stored choice, and keeps
	 * everything else.
	 *
	 * @return void
	 */
	public function test_removes_photo_data_and_keeps_the_rest() {
		$this->assertTrue( PhotoCleanup::run() );

		$this->assertSame( array( 'wp_fair_audience_participants' => true ), $this->db->tables );
		$this->assertSame( array( array( 2, 'locale' ) ), array_values( $this->db->user_meta ) );
		$this->assertSame(
			array( 'polls' => false ),
			$GLOBALS['_fair_test_options']['fair_audience_experimental_features']
		);
	}

	/**
	 * A second run over an already cleaned site succeeds without changes.
	 *
	 * @return void
	 */
	public function test_repeated_run_is_a_no_op() {
		PhotoCleanup::run();
		$options_after_first = $GLOBALS['_fair_test_options'];

		$this->assertTrue( PhotoCleanup::run() );
		$this->assertSame( array( 'wp_fair_audience_participants' => true ), $this->db->tables );
		$this->assertSame( $options_after_first, $GLOBALS['_fair_test_options'] );
	}

	/**
	 * Without data (fresh install, companion never configured) nothing is
	 * written and the run succeeds.
	 *
	 * @return void
	 */
	public function test_missing_data_is_left_alone() {
		$this->db->tables              = array();
		$this->db->user_meta           = array();
		$GLOBALS['_fair_test_options'] = array();

		$this->assertTrue( PhotoCleanup::run() );
		$this->assertSame( array(), $GLOBALS['_fair_test_options'] );
	}

	/**
	 * A failed drop reports failure, the other steps still run, and a retry
	 * finishes the job.
	 *
	 * @return void
	 */
	public function test_failed_drop_is_reported_and_retry_recovers() {
		$this->db->fail_drop = true;

		$this->assertFalse( PhotoCleanup::run() );
		$this->assertArrayHasKey( 'wp_fair_audience_photo_participants', $this->db->tables );
		$this->assertSame( array( array( 2, 'locale' ) ), array_values( $this->db->user_meta ) );

		$this->db->fail_drop = false;

		$this->assertTrue( PhotoCleanup::run() );
		$this->assertSame( array( 'wp_fair_audience_participants' => true ), $this->db->tables );
	}

	/**
	 * User meta that survives the delete is reported, and a retry recovers.
	 *
	 * @return void
	 */
	public function test_remaining_user_meta_is_reported_and_retry_recovers() {
		$this->db->fail_meta_delete = true;

		$this->assertFalse( PhotoCleanup::run() );

		$this->db->fail_meta_delete = false;

		$this->assertTrue( PhotoCleanup::run() );
		$this->assertSame( array( array( 2, 'locale' ) ), array_values( $this->db->user_meta ) );
	}

	/**
	 * An older companion's sanitizer, which would restore the stored choice,
	 * is detached for the write and restored afterwards.
	 *
	 * @return void
	 */
	public function test_old_companion_sanitizer_does_not_restore_the_choice() {
		$sanitizer = array(
			'callback' => function ( $value ) {
				$stored = get_option( 'fair_audience_experimental_features', array() );
				return $value + array_intersect_key( $stored, array( 'photos' => true ) );
			},
		);

		$GLOBALS['wp_filter']['sanitize_option_fair_audience_experimental_features'] = $sanitizer;

		$this->assertTrue( PhotoCleanup::run() );
		$this->assertSame(
			array( 'polls' => false ),
			$GLOBALS['_fair_test_options']['fair_audience_experimental_features']
		);
		$this->assertSame(
			$sanitizer,
			$GLOBALS['wp_filter']['sanitize_option_fair_audience_experimental_features']
		);
	}
}
