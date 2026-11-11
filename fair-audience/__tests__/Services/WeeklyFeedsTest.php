<?php
/**
 * WeeklyFeeds tests
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use FairAudience\Models\Participant;
use FairAudience\Services\WeeklyFeeds;
use FairAudience\Tests\Services\Fakes\FakeParticipantFeedRepository;
use FairAudience\Tests\Services\Fakes\FakeWeeklyFeedCatalog;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/fakes/FakeWeeklyFeedCatalog.php';
require_once __DIR__ . '/fakes/FakeParticipantFeedRepository.php';

/**
 * A chosen feed never widens to other feeds: invalid choices are refused,
 * unavailable ones are kept, and only explicit subscriptions are in scope,
 * whatever the participant's (legacy) feed mode.
 */
class WeeklyFeedsTest extends TestCase {

	/**
	 * Stored feeds.
	 *
	 * @var FakeParticipantFeedRepository
	 */
	private $repository;

	/**
	 * Reset the fakes.
	 */
	protected function setUp(): void {
		$this->repository = new FakeParticipantFeedRepository();
	}

	/**
	 * Feeds offering Workshops (1) and Concerts (2); Archive (3) still exists.
	 *
	 * @return WeeklyFeeds
	 */
	private function feeds() {
		return new WeeklyFeeds( new FakeWeeklyFeedCatalog(), $this->repository );
	}

	/**
	 * A participant whose saves are counted.
	 *
	 * @param string $mode    Feed mode.
	 * @param bool   $opt_out Weekly opt-out.
	 * @param bool   $saves   Whether saving succeeds.
	 * @return Participant
	 */
	private static function participant( $mode = WeeklyFeeds::MODE_SELECTED, $opt_out = false, $saves = true ) {
		$participant = new class( $saves ) extends Participant {
			/**
			 * Number of saves.
			 *
			 * @var int
			 */
			public $saves = 0;

			/**
			 * Whether saving succeeds.
			 *
			 * @var bool
			 */
			private $succeeds;

			/**
			 * Constructor.
			 *
			 * @param bool $succeeds Whether saving succeeds.
			 */
			public function __construct( $succeeds ) {
				$this->succeeds = $succeeds;
			}

			/**
			 * Count the save.
			 *
			 * @return bool
			 */
			public function save() {
				++$this->saves;
				return $this->succeeds;
			}
		};

		$participant->id                     = 7;
		$participant->name                   = 'Ada';
		$participant->email_profile          = 'marketing';
		$participant->status                 = 'confirmed';
		$participant->weekly_summary_opt_out = $opt_out ? 1 : 0;
		$participant->weekly_feed_mode       = $mode;
		return $participant;
	}

	/** Offered feeds are accepted and sorted. */
	public function test_accepts_offered_feeds() {
		$this->assertSame( array( 1, 2 ), $this->feeds()->resolve_selection( array( '2', 1 ) ) );
	}

	/** An explicit empty selection stays empty. */
	public function test_empty_selection_means_no_feeds() {
		$this->assertSame( array(), $this->feeds()->resolve_selection( array() ) );
	}

	/** A feed that is not offered rejects the whole selection. */
	public function test_rejects_feeds_that_are_not_offered() {
		foreach ( array( array( 1, 3 ), array( 99 ), array( '1x' ), array( 0 ), 'all' ) as $submitted ) {
			$result = $this->feeds()->resolve_selection( $submitted );

			$this->assertInstanceOf( \WP_Error::class, $result, var_export( $submitted, true ) ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_var_export -- assertion message.
			$this->assertSame( 'invalid_weekly_feeds', $result->get_error_code() );
		}
	}

	/** Without Fair Events nothing can be chosen. */
	public function test_rejects_any_selection_without_fair_events() {
		$result = ( new WeeklyFeeds( false, $this->repository ) )->resolve_selection( array( 1 ) );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'weekly_feeds_unavailable', $result->get_error_code() );
	}

	/** The summary names chosen feeds, unavailable ones, and counts deleted ones. */
	public function test_summary_classifies_chosen_feeds() {
		$this->assertSame(
			array(
				'available'   => true,
				'selected'    => array(
					array(
						'id'   => 1,
						'name' => 'Workshops',
					),
				),
				'unavailable' => array(
					array(
						'id'   => 3,
						'name' => 'Archive',
					),
				),
				'deleted'     => 1,
			),
			$this->feeds()->summary( array( 1, 3, 42 ) )
		);
	}

	/** An empty choice lists no feeds. */
	public function test_summary_lists_no_feeds_for_none() {
		$empty = array(
			'available'   => true,
			'selected'    => array(),
			'unavailable' => array(),
			'deleted'     => 0,
		);

		$this->assertSame( $empty, $this->feeds()->summary( array() ) );
	}

	/** Without a working catalog, chosen feeds are never reported as deleted. */
	public function test_summary_is_unavailable_without_a_working_catalog() {
		$unavailable = array(
			'available'   => false,
			'selected'    => array(),
			'unavailable' => array(),
			'deleted'     => 0,
		);

		$this->assertSame( $unavailable, ( new WeeklyFeeds( false, $this->repository ) )->summary( array( 1, 42 ) ) );

		$failing = new class() extends FakeWeeklyFeedCatalog {
			/**
			 * Fail like a broken database.
			 *
			 * @throws \RuntimeException Always.
			 */
			public function subscribable() {
				throw new \RuntimeException( 'Database unavailable' );
			}
		};
		$this->assertSame( $unavailable, ( new WeeklyFeeds( $failing, $this->repository ) )->summary( array( 1, 42 ) ) );
	}

	/** Stored feeds that cannot be chosen now are kept. */
	public function test_keeps_stored_feeds_that_are_unavailable() {
		$this->assertSame( array( 2, 3 ), $this->feeds()->resolve_selection( array( 2 ), array( 1, 3 ) ) );
	}

	/** Chosen feeds that cannot be chosen now are described; deleted ones counted. */
	public function test_describes_unavailable_feeds() {
		$this->assertSame(
			array(
				'unavailable' => array(
					array(
						'id'   => 3,
						'name' => 'Archive',
					),
				),
				'deleted'     => 1,
			),
			$this->feeds()->unavailable( array( 1, 3, 42 ) )
		);
	}

	/** Only an explicit subscription to the feed is in scope. */
	public function test_scope_needs_an_explicit_subscription() {
		$chooser = self::participant();
		$this->assertTrue( WeeklyFeeds::in_scope( $chooser, 1, array( 7 ) ) );
		$this->assertFalse( WeeklyFeeds::in_scope( $chooser, 2, array( 8 ) ), 'A newly created feed has no subscribers yet.' );
		$this->assertFalse( WeeklyFeeds::in_scope( $chooser, 2, array() ), 'Zero selections never fall back to other feeds.' );
		$this->assertFalse( WeeklyFeeds::in_scope( $chooser, 0, array( 7 ) ), 'An unknown feed reaches nobody.' );
		$this->assertFalse( WeeklyFeeds::in_scope( $chooser, -1, array( 7 ) ), 'An invalid feed reaches nobody.' );
	}

	/** A legacy participant not converted yet receives only explicit feeds. */
	public function test_unconverted_legacy_mode_never_widens_delivery() {
		$legacy = self::participant( WeeklyFeeds::LEGACY_MODE_ALL );

		$this->assertFalse( WeeklyFeeds::in_scope( $legacy, 1, array() ) );
		$this->assertFalse( WeeklyFeeds::in_scope( $legacy, 0, array() ) );
		$this->assertTrue( WeeklyFeeds::in_scope( $legacy, 1, array( 7 ) ) );
	}

	/** Choosing feeds switches to the selected mode without clearing the opt-out. */
	public function test_choosing_feeds_never_clears_the_weekly_opt_out() {
		$participant = self::participant( WeeklyFeeds::LEGACY_MODE_ALL, true );

		$this->assertTrue( $this->feeds()->apply( $participant, array( 'feed_ids' => array( 2 ) ) ) );

		$this->assertSame( WeeklyFeeds::MODE_SELECTED, $participant->weekly_feed_mode );
		$this->assertSame( 1, $participant->weekly_summary_opt_out );
		$this->assertSame( array( 2 ), $this->repository->feeds[7] );
	}

	/** Absent preferences change nothing and save nothing. */
	public function test_absent_preferences_change_nothing() {
		$participant = self::participant();

		$this->assertTrue( $this->feeds()->apply( $participant, array() ) );

		$this->assertSame( 0, $participant->saves );
		$this->assertSame( WeeklyFeeds::MODE_SELECTED, $participant->weekly_feed_mode );
		$this->assertArrayNotHasKey( 7, $this->repository->feeds );
	}

	/** The weekly switch alone keeps the feeds and the marketing consent. */
	public function test_weekly_switch_alone_keeps_the_feeds() {
		$participant                = self::participant( WeeklyFeeds::MODE_SELECTED, true );
		$participant->email_profile = 'minimal';
		$this->repository->feeds[7] = array( 2 );

		$this->assertTrue( $this->feeds()->apply( $participant, array( 'weekly_summary' => true ) ) );
		$this->assertSame( 0, $participant->weekly_summary_opt_out );
		$this->assertSame( array( 2 ), $this->repository->feeds[7] );

		$this->assertTrue( $this->feeds()->apply( $participant, array( 'weekly_summary' => false ) ) );
		$this->assertSame( 1, $participant->weekly_summary_opt_out );
		$this->assertSame( array( 2 ), $this->repository->feeds[7], 'Pausing keeps the selected feeds.' );
		$this->assertSame( 'minimal', $participant->email_profile );
	}

	/** Clearing every feed keeps the weekly and marketing preferences. */
	public function test_clearing_feeds_keeps_other_preferences() {
		$participant                = self::participant();
		$this->repository->feeds[7] = array( 1, 2 );

		$this->assertTrue( $this->feeds()->apply( $participant, array( 'feed_ids' => array() ) ) );

		$this->assertSame( array(), $this->repository->feeds[7] );
		$this->assertSame( 'marketing', $participant->email_profile );
		$this->assertSame( 0, $participant->weekly_summary_opt_out );
	}

	/** A strict apply refuses an invalid feed before changing anything. */
	public function test_strict_apply_changes_nothing_for_an_invalid_feed() {
		$participant = self::participant();

		$result = $this->feeds()->apply(
			$participant,
			array(
				'weekly_summary' => false,
				'feed_ids'       => array( 3 ),
			)
		);

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 0, $participant->saves );
		$this->assertSame( 0, $participant->weekly_summary_opt_out );
		$this->assertArrayNotHasKey( 7, $this->repository->feeds );
	}

	/** Preferences checked earlier lose feeds that became unavailable, and gain none. */
	public function test_lenient_apply_narrows_to_feeds_still_offered() {
		$participant = self::participant();

		$this->assertTrue( $this->feeds()->apply( $participant, array( 'feed_ids' => array( 1, 3 ) ), false ) );

		$this->assertSame( array( 1 ), $this->repository->feeds[7] );
		$this->assertSame( WeeklyFeeds::MODE_SELECTED, $participant->weekly_feed_mode );
	}

	/** Without Fair Events, preferences checked earlier are stored as they are. */
	public function test_lenient_apply_without_fair_events_keeps_the_choice() {
		$participant = self::participant();

		$this->assertTrue( ( new WeeklyFeeds( false, $this->repository ) )->apply( $participant, array( 'feed_ids' => array( 3 ) ), false ) );

		$this->assertSame( array( 3 ), $this->repository->feeds[7] );
		$this->assertSame( WeeklyFeeds::MODE_SELECTED, $participant->weekly_feed_mode );
	}

	/** The former all-feeds choice is refused, with or without a catalog. */
	public function test_all_feeds_choice_is_refused() {
		foreach ( array( $this->feeds(), new WeeklyFeeds( false, $this->repository ) ) as $feeds ) {
			$result = $feeds->resolve_choice( WeeklyFeeds::LEGACY_MODE_ALL, null, array( 1, 3 ) );

			$this->assertInstanceOf( \WP_Error::class, $result );
			$this->assertSame( 'invalid_weekly_feeds', $result->get_error_code() );
		}
	}

	/** The no-feeds choice clears every stored feed, unavailable ones too. */
	public function test_no_feeds_choice_clears_every_feed() {
		$expected = array(
			'mode'     => WeeklyFeeds::MODE_SELECTED,
			'feed_ids' => array(),
		);

		$this->assertSame( $expected, $this->feeds()->resolve_choice( 'none', null, array( 1, 3, 42 ) ) );
		$this->assertSame( $expected, ( new WeeklyFeeds( false, $this->repository ) )->resolve_choice( 'none', null, array( 1 ) ) );
	}

	/** Chosen feeds are checked, keeping stored feeds that cannot be chosen now. */
	public function test_selected_choice_keeps_unavailable_feeds() {
		$this->assertSame(
			array(
				'mode'     => WeeklyFeeds::MODE_SELECTED,
				'feed_ids' => array( 2, 3, 42 ),
			),
			$this->feeds()->resolve_choice( WeeklyFeeds::MODE_SELECTED, array( 2 ), array( 1, 3, 42 ) )
		);
	}

	/** An invalid or uncheckable choice is refused rather than widened or cleared. */
	public function test_selected_choice_refuses_what_it_cannot_check() {
		$cases = array(
			'invalid_weekly_feeds'     => array( $this->feeds(), WeeklyFeeds::MODE_SELECTED, array( 3 ) ),
			'weekly_feeds_unavailable' => array( new WeeklyFeeds( false, $this->repository ), WeeklyFeeds::MODE_SELECTED, array( 1 ) ),
		);
		foreach ( $cases as $code => list( $feeds, $mode, $submitted ) ) {
			$result = $feeds->resolve_choice( $mode, $submitted, array( 1 ) );

			$this->assertInstanceOf( \WP_Error::class, $result, $code );
			$this->assertSame( $code, $result->get_error_code() );
		}

		foreach ( array( array( WeeklyFeeds::MODE_SELECTED, null ), array( 'some', array( 1 ) ) ) as list( $mode, $submitted ) ) {
			$result = $this->feeds()->resolve_choice( $mode, $submitted );
			$this->assertInstanceOf( \WP_Error::class, $result, $mode );
			$this->assertSame( 'invalid_weekly_feeds', $result->get_error_code() );
		}
	}

	/** Storage failures are reported. */
	public function test_reports_storage_failures() {
		$this->repository->fails = true;
		$this->assertInstanceOf( \WP_Error::class, $this->feeds()->apply( self::participant(), array( 'feed_ids' => array( 1 ) ) ) );

		$this->repository->fails = false;
		$this->assertInstanceOf( \WP_Error::class, $this->feeds()->apply( self::participant( WeeklyFeeds::MODE_SELECTED, false, false ), array( 'weekly_summary' => true ) ) );
	}
}
