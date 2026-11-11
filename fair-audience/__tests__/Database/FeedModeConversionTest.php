<?php
/**
 * FeedModeConversion tests
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Database;

use FairAudience\Database\FeedModeConversion;
use FairAudience\Services\LegacyFeedPreferences;
use FairAudience\Services\WeeklyFeeds;
use PHPUnit\Framework\TestCase;

/**
 * The legacy "all weekly emails" mode converts once into explicit
 * subscriptions to the feeds eligible when the conversion started, keeping
 * every other preference, and a retry never adds a feed created later.
 */
class FeedModeConversionTest extends TestCase {

	/**
	 * In-memory participants and feeds.
	 *
	 * @var object
	 */
	private $store;

	/**
	 * Feed IDs the catalog lists; null when it cannot be read.
	 *
	 * @var int[]|null
	 */
	private $catalog;

	/**
	 * How often the catalog was read.
	 *
	 * @var int
	 */
	private $reads;

	/**
	 * Reset the fakes.
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
		$this->catalog                 = array( 1, 2 );
		$this->reads                   = 0;
		$this->store                   = new class() {
			/**
			 * Participants by ID.
			 *
			 * @var array[]
			 */
			public $participants = array();

			/**
			 * Feed IDs by participant ID.
			 *
			 * @var int[][]
			 */
			public $feeds = array();

			/**
			 * Participant IDs whose conversion fails.
			 *
			 * @var int[]
			 */
			public $failing = array();

			/**
			 * Whether any participant has the legacy mode.
			 *
			 * @return bool
			 */
			public function has_legacy() {
				return (bool) $this->legacy_batch( 1 );
			}

			/**
			 * Legacy participants in ID order.
			 *
			 * @param int $limit How many.
			 * @return array[]
			 */
			public function legacy_batch( $limit ) {
				$rows = array_values(
					array_filter(
						$this->participants,
						static function ( $row ) {
							return WeeklyFeeds::LEGACY_MODE_ALL === $row['weekly_feed_mode'];
						}
					)
				);
				return array_slice( $rows, 0, $limit );
			}

			/**
			 * Add feeds and convert, together or not at all.
			 *
			 * @param int   $id       Participant ID.
			 * @param int[] $feed_ids Feeds to add.
			 * @return bool
			 */
			public function convert( $id, array $feed_ids ) {
				if ( in_array( $id, $this->failing, true ) ) {
					return false;
				}
				$this->feeds[ $id ] = array_values( array_unique( array_merge( $this->feeds[ $id ] ?? array(), $feed_ids ) ) );
				sort( $this->feeds[ $id ] );
				$this->participants[ $id ]['weekly_feed_mode'] = WeeklyFeeds::MODE_SELECTED;
				return true;
			}
		};
	}

	/**
	 * Add a participant.
	 *
	 * @param int    $id      ID.
	 * @param string $mode    Feed mode.
	 * @param string $profile Email profile.
	 * @param string $status  Status.
	 * @param int    $opt_out Weekly opt-out.
	 */
	private function add( $id, $mode = WeeklyFeeds::LEGACY_MODE_ALL, $profile = 'marketing', $status = 'confirmed', $opt_out = 0 ) {
		$this->store->participants[ $id ] = array(
			'id'                     => $id,
			'weekly_feed_mode'       => $mode,
			'email_profile'          => $profile,
			'status'                 => $status,
			'weekly_summary_opt_out' => $opt_out,
		);
	}

	/**
	 * Conversion backed by the fakes.
	 *
	 * @return FeedModeConversion
	 */
	private function conversion() {
		return new FeedModeConversion(
			function () {
				++$this->reads;
				return $this->catalog;
			},
			$this->store
		);
	}

	/** Receiving legacy participants get the eligible feeds; others get none and keep their preferences. */
	public function test_converts_receiving_participants_to_eligible_feeds() {
		$this->add( 1 );
		$this->add( 2, WeeklyFeeds::LEGACY_MODE_ALL, 'minimal' );
		$this->add( 3, WeeklyFeeds::LEGACY_MODE_ALL, 'marketing', 'pending' );
		$this->add( 4, WeeklyFeeds::LEGACY_MODE_ALL, 'marketing', 'confirmed', 1 );

		$this->assertTrue( $this->conversion()->convert() );

		$this->assertSame( array( 1, 2 ), $this->store->feeds[1] );
		$this->assertSame( array(), $this->store->feeds[2] );
		$this->assertSame( array(), $this->store->feeds[3] );
		$this->assertSame( array(), $this->store->feeds[4] );
		foreach ( $this->store->participants as $row ) {
			$this->assertSame( WeeklyFeeds::MODE_SELECTED, $row['weekly_feed_mode'] );
		}
		$this->assertSame( 'minimal', $this->store->participants[2]['email_profile'], 'Conversion never grants marketing consent.' );
		$this->assertSame( 'pending', $this->store->participants[3]['status'] );
		$this->assertSame( 1, $this->store->participants[4]['weekly_summary_opt_out'] );
		$this->assertArrayNotHasKey( FeedModeConversion::SNAPSHOT_OPTION, $GLOBALS['_fair_test_options'] );
	}

	/** Existing explicit selections are kept, both for selected and legacy participants. */
	public function test_keeps_existing_explicit_selections() {
		$this->add( 1, WeeklyFeeds::MODE_SELECTED );
		$this->store->feeds[1] = array( 2 );
		$this->add( 2 );
		$this->store->feeds[2] = array( 7 );

		$this->assertTrue( $this->conversion()->convert() );

		$this->assertSame( array( 2 ), $this->store->feeds[1], 'A selected participant is never touched.' );
		$this->assertSame( array( 1, 2, 7 ), $this->store->feeds[2] );
	}

	/** A successfully read empty catalog completes with zero subscriptions, no fallback. */
	public function test_empty_catalog_converts_to_no_feeds() {
		$this->catalog = array();
		$this->add( 1 );

		$this->assertTrue( $this->conversion()->convert() );

		$this->assertSame( array(), $this->store->feeds[1] );
		$this->assertSame( WeeklyFeeds::MODE_SELECTED, $this->store->participants[1]['weekly_feed_mode'] );
	}

	/** An unreadable catalog defers the conversion and changes nothing. */
	public function test_unreadable_catalog_defers_the_conversion() {
		$this->catalog = null;
		$this->add( 1 );

		$this->assertFalse( $this->conversion()->convert() );

		$this->assertSame( WeeklyFeeds::LEGACY_MODE_ALL, $this->store->participants[1]['weekly_feed_mode'] );
		$this->assertArrayNotHasKey( 1, $this->store->feeds );
		$this->assertArrayNotHasKey( FeedModeConversion::SNAPSHOT_OPTION, $GLOBALS['_fair_test_options'] );

		$this->catalog = array( 2 );
		$this->assertTrue( $this->conversion()->convert() );
		$this->assertSame( array( 2 ), $this->store->feeds[1] );
	}

	/** Without legacy participants the conversion completes without the catalog. */
	public function test_nothing_to_convert_needs_no_catalog() {
		$this->catalog = null;
		$this->add( 1, WeeklyFeeds::MODE_SELECTED );

		$this->assertTrue( $this->conversion()->convert() );
		$this->assertSame( 0, $this->reads );
	}

	/** A failed participant stops the run; the retry uses the stored snapshot, not feeds created since. */
	public function test_retry_after_failure_ignores_feeds_created_later() {
		$this->add( 1 );
		$this->add( 2 );
		$this->store->failing = array( 2 );

		$this->assertFalse( $this->conversion()->convert() );
		$this->assertSame( array( 1, 2 ), $this->store->feeds[1] );
		$this->assertSame( WeeklyFeeds::LEGACY_MODE_ALL, $this->store->participants[2]['weekly_feed_mode'] );

		$this->catalog        = array( 1, 2, 3 );
		$this->store->failing = array();

		$this->assertTrue( $this->conversion()->convert() );
		$this->assertSame( array( 1, 2 ), $this->store->feeds[2], 'Feed 3 was created after the conversion started.' );
		$this->assertSame( array( 1, 2 ), $this->store->feeds[1] );
		$this->assertSame( 1, $this->reads );
	}

	/** Converted participants are never processed again, even when rerun later. */
	public function test_rerun_never_adds_newly_created_feeds() {
		$this->add( 1 );
		$this->assertTrue( $this->conversion()->convert() );

		$this->catalog = array( 1, 2, 3 );
		$this->assertTrue( $this->conversion()->convert() );

		$this->assertSame( array( 1, 2 ), $this->store->feeds[1] );
	}

	/** Large sites convert a batch per run, all with the first snapshot. */
	public function test_converts_in_batches_with_one_snapshot() {
		for ( $id = 1; $id <= FeedModeConversion::BATCH_SIZE + 1; $id++ ) {
			$this->add( $id );
		}

		$this->assertFalse( $this->conversion()->convert(), 'More participants remain after the first batch.' );
		$this->assertSame( WeeklyFeeds::LEGACY_MODE_ALL, $this->store->participants[ FeedModeConversion::BATCH_SIZE + 1 ]['weekly_feed_mode'] );

		$this->catalog = array( 9 );
		$this->assertTrue( $this->conversion()->convert() );
		$this->assertSame( array( 1, 2 ), $this->store->feeds[ FeedModeConversion::BATCH_SIZE + 1 ] );
		$this->assertSame( 1, $this->reads );
	}

	/** The site's catalog reader treats a missing Fair Events as unreadable, never as empty. */
	public function test_missing_fair_events_is_unreadable() {
		if ( class_exists( '\FairEvents\Notifications\WeeklyFeedCatalog' ) ) {
			$this->markTestSkipped( 'Fair Events is loaded.' );
		}

		$this->assertNull( FeedModeConversion::read_eligible_feeds() );
	}

	/** Same-site upgrade expands legacy 'all' for receiving participants only. */
	public function test_same_site_upgrade_contract() {
		$receiving = array(
			'weekly_feed_mode'       => 'all',
			'email_profile'          => 'marketing',
			'status'                 => 'confirmed',
			'weekly_summary_opt_out' => 0,
		);

		$this->assertSame( array( 1, 2 ), LegacyFeedPreferences::for_same_site_upgrade( $receiving, array( 1, 2 ) ) );
		$this->assertSame( array(), LegacyFeedPreferences::for_same_site_upgrade( array_merge( $receiving, array( 'weekly_feed_mode' => 'selected' ) ), array( 1, 2 ) ) );
		$this->assertSame( array(), LegacyFeedPreferences::for_same_site_upgrade( array_merge( $receiving, array( 'email_profile' => 'minimal' ) ), array( 1, 2 ) ) );
		$this->assertSame( array(), LegacyFeedPreferences::for_same_site_upgrade( $receiving, array() ) );
	}

	/**
	 * Cross-site import (#2218): both legacy modes create zero destination
	 * subscriptions, keep marketing and the weekly opt-out independently,
	 * and differ in nothing else.
	 */
	public function test_cross_site_import_contract() {
		$cases = array(
			array( 'all', 'marketing', 0 ),
			array( 'all', 'minimal', 1 ),
			array( 'selected', 'marketing', 1 ),
			array( 'selected', 'declined', 0 ),
		);
		foreach ( $cases as list( $mode, $profile, $opt_out ) ) {
			$row = array(
				'weekly_feed_mode'       => $mode,
				'email_profile'          => $profile,
				'weekly_summary_opt_out' => $opt_out,
				'feed_ids'               => array( 1, 2 ),
			);

			$this->assertSame(
				array(
					'email_profile'          => $profile,
					'weekly_summary_opt_out' => (bool) $opt_out,
					'feed_ids'               => array(),
					'feeds_need_selection'   => true,
				),
				LegacyFeedPreferences::for_import( $row ),
				"$mode/$profile/$opt_out"
			);
		}

		$base = array(
			'email_profile'          => 'marketing',
			'weekly_summary_opt_out' => 0,
		);
		$this->assertSame(
			LegacyFeedPreferences::for_import( array_merge( $base, array( 'weekly_feed_mode' => 'all' ) ) ),
			LegacyFeedPreferences::for_import( array_merge( $base, array( 'weekly_feed_mode' => 'selected' ) ) ),
			'The legacy feed mode alone is not a conflict.'
		);
		$this->assertSame( 'minimal', LegacyFeedPreferences::for_import( array( 'email_profile' => 'bogus' ) )['email_profile'] );
	}
}
