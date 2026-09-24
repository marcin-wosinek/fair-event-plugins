<?php
/**
 * Gallery cleanup tests.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Database;

// The cleanup needs a small table-tracking wpdb double in the same file and
// swaps the WordPress database global for the duration of each test.
// phpcs:disable Generic.Files.OneObjectStructurePerFile.MultipleFound
// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited

use FairAudience\Database\GalleryCleanup;
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
 * Covers the 1.44.0 gallery removal.
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
		$this->db                      = new Gallery_Cleanup_WPDB();
		$this->db->tables              = array(
			'wp_fair_audience_gallery_access_keys' => true,
			'wp_fair_audience_photo_participants'  => true,
		);
		$GLOBALS['wpdb']               = $this->db;
		$GLOBALS['_fair_test_options'] = array(
			'fair_audience_experimental_features' => array(
				'galleries' => false,
				'polls'     => true,
			),
		);
	}

	/**
	 * Remove the database double after each test.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['wpdb'] );
		$GLOBALS['_fair_test_options'] = array();
		parent::tearDown();
	}

	/**
	 * Cleanup drops the access keys, keeps photo attribution, and carries
	 * the stored choice over to the photos bundle.
	 *
	 * @return void
	 */
	public function test_removes_access_keys_and_migrates_flag() {
		$this->assertTrue( GalleryCleanup::run() );

		$this->assertSame( array( 'wp_fair_audience_photo_participants' => true ), $this->db->tables );
		$this->assertSame(
			array(
				'polls'  => true,
				'photos' => false,
			),
			$GLOBALS['_fair_test_options']['fair_audience_experimental_features']
		);
	}

	/**
	 * An explicit photos choice is not overwritten by the legacy value.
	 *
	 * @return void
	 */
	public function test_existing_photos_choice_wins() {
		$GLOBALS['_fair_test_options']['fair_audience_experimental_features']['photos'] = true;

		$this->assertTrue( GalleryCleanup::run() );
		$this->assertSame(
			array(
				'polls'  => true,
				'photos' => true,
			),
			$GLOBALS['_fair_test_options']['fair_audience_experimental_features']
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
		$this->assertSame( array( 'wp_fair_audience_photo_participants' => true ), $this->db->tables );
		$this->assertSame( $options_after_first, $GLOBALS['_fair_test_options'] );
	}

	/**
	 * Without a stored option (fresh install or companion never configured)
	 * nothing is written.
	 *
	 * @return void
	 */
	public function test_missing_option_is_left_alone() {
		$GLOBALS['_fair_test_options'] = array();

		$this->assertTrue( GalleryCleanup::run() );
		$this->assertSame( array(), $GLOBALS['_fair_test_options'] );
	}

	/**
	 * A failed drop reports failure and a retry finishes the job.
	 *
	 * @return void
	 */
	public function test_failed_drop_is_reported_and_retry_recovers() {
		$this->db->failing = array( 'wp_fair_audience_gallery_access_keys' => true );

		$this->assertFalse( GalleryCleanup::run() );
		$this->assertArrayHasKey( 'wp_fair_audience_gallery_access_keys', $this->db->tables );

		$this->db->failing = array();

		$this->assertTrue( GalleryCleanup::run() );
		$this->assertSame( array( 'wp_fair_audience_photo_participants' => true ), $this->db->tables );
	}
}
