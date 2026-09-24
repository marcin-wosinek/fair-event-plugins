<?php
/**
 * Gallery cleanup tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Database;

// The cleanup needs a small table-tracking wpdb double in the same file and
// swaps the WordPress database global for the duration of each test.
// phpcs:disable Generic.Files.OneObjectStructurePerFile.MultipleFound
// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited

use FairEvents\Database\GalleryCleanup;
use PHPUnit\Framework\TestCase;

/**
 * Tracks which tables exist and can fail DROP TABLE for chosen tables.
 */
class Gallery_Cleanup_WPDB {
	/**
	 * WordPress table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Existing tables, keyed by full name.
	 *
	 * @var array<string, true>
	 */
	public $tables = array();

	/**
	 * Tables whose DROP fails, keyed by full name.
	 *
	 * @var array<string, true>
	 */
	public $failing = array();

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
		$table = $prepared['args'][0];
		if ( isset( $this->failing[ $table ] ) ) {
			return false;
		}
		unset( $this->tables[ $table ] );
		return 0;
	}
}

/**
 * Covers the 3.36.0 gallery removal.
 */
class GalleryCleanupTest extends TestCase {

	/**
	 * Database double used by the test.
	 *
	 * @var Gallery_Cleanup_WPDB
	 */
	private $db;

	/**
	 * Seed an installation that still has gallery data.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->db                               = new Gallery_Cleanup_WPDB();
		$this->db->tables                       = array(
			'wp_fair_events_event_photos' => true,
			'wp_fair_events_photo_likes'  => true,
			'wp_fair_event_dates'         => true,
		);
		$GLOBALS['wpdb']                        = $this->db;
		$GLOBALS['_fair_test_options']          = array(
			'fair_events_experimental_features' => array(
				'galleries' => true,
				'ticketing' => false,
			),
			'rewrite_rules'                     => array( '^event-gallery/([0-9]+)/?$' => 'index.php' ),
		);
		$GLOBALS['_fair_test_deleted_metadata'] = array();
	}

	/**
	 * Restore the shared database double after each test.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb']               = new \Fair_Test_WPDB();
		$GLOBALS['_fair_test_options'] = array();
		parent::tearDown();
	}

	/**
	 * Cleanup drops only gallery tables and gallery settings.
	 *
	 * @return void
	 */
	public function test_removes_gallery_data_and_keeps_the_rest() {
		$this->assertTrue( GalleryCleanup::run() );

		$this->assertSame( array( 'wp_fair_event_dates' => true ), $this->db->tables );
		$this->assertSame(
			array( 'ticketing' => false ),
			$GLOBALS['_fair_test_options']['fair_events_experimental_features']
		);
		$this->assertArrayNotHasKey( 'rewrite_rules', $GLOBALS['_fair_test_options'] );
		$this->assertSame(
			array( array( 'user', 0, 'fair_events_bulk_upload_event', '', true ) ),
			$GLOBALS['_fair_test_deleted_metadata']
		);
	}

	/**
	 * A second run over an already cleaned site succeeds without changes.
	 *
	 * @return void
	 */
	public function test_repeated_run_is_a_no_op() {
		GalleryCleanup::run();
		$options_after_first = $GLOBALS['_fair_test_options'];

		$this->assertTrue( GalleryCleanup::run() );
		$this->assertSame( array( 'wp_fair_event_dates' => true ), $this->db->tables );
		$this->assertSame( $options_after_first, $GLOBALS['_fair_test_options'] );
	}

	/**
	 * Fresh installs have no gallery tables or option to clean.
	 *
	 * @return void
	 */
	public function test_fresh_install_succeeds() {
		$this->db->tables              = array( 'wp_fair_event_dates' => true );
		$GLOBALS['_fair_test_options'] = array();

		$this->assertTrue( GalleryCleanup::run() );
		$this->assertArrayNotHasKey( 'fair_events_experimental_features', $GLOBALS['_fair_test_options'] );
	}

	/**
	 * A failed drop reports failure and a retry finishes the job.
	 *
	 * @return void
	 */
	public function test_failed_drop_is_reported_and_retry_recovers() {
		$this->db->failing = array( 'wp_fair_events_event_photos' => true );

		$this->assertFalse( GalleryCleanup::run() );
		$this->assertArrayHasKey( 'wp_fair_events_event_photos', $this->db->tables );
		$this->assertArrayNotHasKey( 'wp_fair_events_photo_likes', $this->db->tables );

		$this->db->failing = array();

		$this->assertTrue( GalleryCleanup::run() );
		$this->assertSame( array( 'wp_fair_event_dates' => true ), $this->db->tables );
	}
}
