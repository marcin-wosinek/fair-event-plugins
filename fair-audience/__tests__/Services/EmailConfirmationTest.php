<?php
/**
 * EmailConfirmation tests.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairAudience\Models\Participant;
use FairAudience\Services\EmailConfirmation;
use FairAudience\Services\WeeklyFeeds;
use FairAudience\Tests\Services\Fakes\FakeParticipantFeedRepository;
use FairAudience\Tests\Services\Fakes\FakeWeeklyFeedCatalog;

require_once __DIR__ . '/fakes/FakeWeeklyFeedCatalog.php';
require_once __DIR__ . '/fakes/FakeParticipantFeedRepository.php';

/**
 * A confirmation applies the preferences submitted with its token, and
 * uses the token up only once everything is stored.
 */
class EmailConfirmationTest extends TestCase {

	/**
	 * Tokens the fake lookup knows, by token string.
	 *
	 * @var object[]
	 */
	private $tokens = array();

	/**
	 * Participants the fake lookup knows, by ID.
	 *
	 * @var Participant[]
	 */
	private $participants = array();

	/**
	 * Stored weekly feeds.
	 *
	 * @var FakeParticipantFeedRepository
	 */
	private $feed_repository;

	/**
	 * Stored announcement categories by participant, and whether storing fails.
	 *
	 * @var object
	 */
	private $categories;

	/**
	 * Participant IDs whose audience session was started.
	 *
	 * @var int[]
	 */
	private $sessions = array();

	/**
	 * Seed a pending participant.
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_transients'] = array();
		$this->feed_repository            = new FakeParticipantFeedRepository();
		$this->categories                 = new class() {
			/**
			 * Categories by participant.
			 *
			 * @var array
			 */
			public $stored = array();

			/**
			 * Whether storing fails.
			 *
			 * @var bool
			 */
			public $fails = false;

			/**
			 * Replace a participant's categories.
			 *
			 * @param int   $participant_id Participant ID.
			 * @param int[] $ids            Category IDs.
			 * @return bool
			 */
			public function set_categories( $participant_id, array $ids ) {
				if ( $this->fails ) {
					return false;
				}
				$this->stored[ $participant_id ] = $ids;
				return true;
			}
		};
		$this->participants               = array( 7 => self::participant() );
		$this->tokens                     = array();
		$this->sessions                   = array();
	}

	/**
	 * A pending participant whose saves can fail.
	 *
	 * @return Participant
	 */
	private static function participant() {
		$participant = new class() extends Participant {
			/**
			 * Whether saving succeeds.
			 *
			 * @var bool
			 */
			public $succeeds = true;

			/**
			 * Constructor.
			 */
			public function __construct() {}

			/**
			 * Report the configured outcome.
			 *
			 * @return bool
			 */
			public function save() {
				return $this->succeeds;
			}
		};

		$participant->id                     = 7;
		$participant->name                   = 'Ada';
		$participant->email_profile          = 'minimal';
		$participant->status                 = 'pending';
		$participant->weekly_summary_opt_out = 0;
		$participant->weekly_feed_mode       = WeeklyFeeds::MODE_ALL;
		return $participant;
	}

	/**
	 * Store a token for participant 7.
	 *
	 * @param array|null $pending_preferences Weekly preferences submitted with it.
	 * @param bool       $expired             Whether it has expired.
	 * @return object
	 */
	private function token( $pending_preferences = null, $expired = false ) {
		$token = new class( $expired ) {
			/**
			 * Participant ID.
			 *
			 * @var int
			 */
			public $participant_id = 7;

			/**
			 * Weekly preferences submitted with the signup.
			 *
			 * @var array|null
			 */
			public $pending_preferences;

			/**
			 * Whether it was deleted.
			 *
			 * @var bool
			 */
			public $deleted = false;

			/**
			 * Whether it has expired.
			 *
			 * @var bool
			 */
			private $expired;

			/**
			 * Constructor.
			 *
			 * @param bool $expired Whether it has expired.
			 */
			public function __construct( $expired ) {
				$this->expired = $expired;
			}

			/**
			 * Whether it has expired.
			 *
			 * @return bool
			 */
			public function is_expired() {
				return $this->expired;
			}

			/**
			 * Mark it deleted.
			 *
			 * @return bool
			 */
			public function delete() {
				$this->deleted = true;
				return true;
			}
		};

		$token->pending_preferences = $pending_preferences;
		$this->tokens['abc']        = $token;
		return $token;
	}

	/**
	 * Confirmation backed by the fakes.
	 *
	 * @return EmailConfirmation
	 */
	private function confirmation() {
		return new EmailConfirmation(
			function ( $token ) {
				return $this->tokens[ $token ] ?? null;
			},
			function ( $participant_id ) {
				return $this->participants[ $participant_id ] ?? null;
			},
			new WeeklyFeeds( new FakeWeeklyFeedCatalog(), $this->feed_repository ),
			$this->categories,
			function ( $participant_id ) {
				$this->sessions[] = $participant_id;
			}
		);
	}

	/** The submitted feeds, weekly opt-out and categories apply, and the token is used up. */
	public function test_applies_submitted_preferences() {
		$token = $this->token(
			array(
				'weekly_summary' => false,
				'feed_ids'       => array( 1 ),
			)
		);
		$GLOBALS['_fair_test_transients']['fair_audience_pending_cats_7'] = array( 4 );

		$this->assertSame( EmailConfirmation::CONFIRMED, $this->confirmation()->confirm( 'abc' ) );

		$participant = $this->participants[7];
		$this->assertSame( 'confirmed', $participant->status );
		$this->assertSame( 'marketing', $participant->email_profile );
		$this->assertSame( WeeklyFeeds::MODE_SELECTED, $participant->weekly_feed_mode );
		$this->assertSame( 1, $participant->weekly_summary_opt_out );
		$this->assertSame( array( 1 ), $this->feed_repository->feeds[7] );
		$this->assertSame( array( 4 ), $this->categories->stored[7] );
		$this->assertArrayNotHasKey( 'fair_audience_pending_cats_7', $GLOBALS['_fair_test_transients'] );
		$this->assertTrue( $token->deleted );
		$this->assertSame( array( 7 ), $this->sessions );
	}

	/** A token without preferences, from before feeds existed, keeps every weekly email. */
	public function test_token_without_preferences_keeps_weekly_defaults() {
		$this->token();

		$this->assertSame( EmailConfirmation::CONFIRMED, $this->confirmation()->confirm( 'abc' ) );

		$this->assertSame( WeeklyFeeds::MODE_ALL, $this->participants[7]->weekly_feed_mode );
		$this->assertSame( 0, $this->participants[7]->weekly_summary_opt_out );
		$this->assertArrayNotHasKey( 7, $this->feed_repository->feeds );
	}

	/** A feed no longer offered is dropped, and none is put in its place. */
	public function test_unavailable_feed_is_left_out() {
		$this->token( array( 'feed_ids' => array( 3 ) ) );

		$this->assertSame( EmailConfirmation::CONFIRMED, $this->confirmation()->confirm( 'abc' ) );

		$this->assertSame( WeeklyFeeds::MODE_SELECTED, $this->participants[7]->weekly_feed_mode );
		$this->assertSame( array(), $this->feed_repository->feeds[7] );
	}

	/** Failing to store anything keeps the token, and a retry succeeds. */
	public function test_failure_keeps_the_token_for_a_retry() {
		$token = $this->token( array( 'feed_ids' => array( 2 ) ) );
		$GLOBALS['_fair_test_transients']['fair_audience_pending_cats_7'] = array( 4 );

		foreach ( array( 'feeds', 'participant', 'categories' ) as $failing ) {
			$this->feed_repository->fails         = 'feeds' === $failing;
			$this->participants[7]->succeeds      = 'participant' !== $failing;
			$this->categories->fails              = 'categories' === $failing;
			$this->participants[7]->status        = 'pending';
			$this->participants[7]->email_profile = 'minimal';

			$this->assertSame( EmailConfirmation::UPDATE_FAILED, $this->confirmation()->confirm( 'abc' ), $failing );
			$this->assertFalse( $token->deleted, $failing );
			$this->assertSame( array(), $this->sessions, $failing );
		}

		$this->categories->fails = false;
		$this->assertSame( EmailConfirmation::CONFIRMED, $this->confirmation()->confirm( 'abc' ) );
		$this->assertSame( array( 2 ), $this->feed_repository->feeds[7] );
		$this->assertSame( array( 4 ), $this->categories->stored[7] );
		$this->assertTrue( $token->deleted );
	}

	/** Unknown, empty, expired and orphaned tokens change nothing. */
	public function test_unusable_tokens_change_nothing() {
		$this->assertSame( EmailConfirmation::INVALID_TOKEN, $this->confirmation()->confirm( 'nope' ) );
		$this->assertSame( EmailConfirmation::INVALID_TOKEN, $this->confirmation()->confirm( '' ) );

		$expired = $this->token( array( 'feed_ids' => array( 1 ) ), true );
		$this->assertSame( EmailConfirmation::TOKEN_EXPIRED, $this->confirmation()->confirm( 'abc' ) );
		$this->assertTrue( $expired->deleted );

		$orphan = $this->token( array( 'feed_ids' => array( 1 ) ) );
		unset( $this->participants[7] );
		$this->assertSame( EmailConfirmation::PARTICIPANT_NOT_FOUND, $this->confirmation()->confirm( 'abc' ) );
		$this->assertTrue( $orphan->deleted );

		$this->assertSame( array(), $this->feed_repository->feeds );
		$this->assertSame( array(), $this->sessions );
	}

	/** An address already on the list still gets the preferences its link carried. */
	public function test_already_subscribed_participant_gets_the_link_preferences() {
		$this->participants[7]->status        = 'confirmed';
		$this->participants[7]->email_profile = 'marketing';
		$token                                = $this->token( array( 'feed_ids' => array( 2 ) ) );

		$this->assertSame( EmailConfirmation::CONFIRMED, $this->confirmation()->confirm( 'abc' ) );
		$this->assertSame( array( 2 ), $this->feed_repository->feeds[7] );
		$this->assertTrue( $token->deleted );
	}

	/** A link that brings nothing new to an address already on the list says so. */
	public function test_already_subscribed_without_pending_choices() {
		$this->participants[7]->status        = 'confirmed';
		$this->participants[7]->email_profile = 'marketing';
		$token                                = $this->token();

		$this->assertSame( EmailConfirmation::ALREADY_CONFIRMED, $this->confirmation()->confirm( 'abc' ) );
		$this->assertTrue( $token->deleted );
	}
}
