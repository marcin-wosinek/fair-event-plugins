<?php
/**
 * EmailService bulk send observer tests
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use FairAudience\Models\Participant;
use FairAudience\Services\EmailService;
use FairAudience\Services\EmailType;
use FairAudience\Services\WeeklyDigestMailer;
use FairAudience\Services\WeeklyFeeds;
use FairAudience\Tests\Services\Fakes\FakeParticipantFeedRepository;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/fakes/FakeParticipantFeedRepository.php';

/**
 * The per-recipient reports Fair Events records in its notification history.
 */
class EmailServiceBulkObserverTest extends TestCase {

	/**
	 * Reset recorded emails.
	 */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_sent_emails'] = array();
	}

	/**
	 * A participant.
	 *
	 * @param int    $id      ID.
	 * @param string $email   Address.
	 * @param string $status  Consent status.
	 * @param bool   $opt_out Weekly summary opt-out.
	 * @param string $mode    Weekly feed mode.
	 * @param string $profile Email profile.
	 * @return Participant
	 */
	private static function participant( $id, $email, $status = 'confirmed', $opt_out = false, $mode = WeeklyFeeds::MODE_SELECTED, $profile = 'marketing' ) {
		$participant                         = new Participant();
		$participant->id                     = $id;
		$participant->name                   = 'Person ' . $id;
		$participant->email                  = $email;
		$participant->email_profile          = $profile;
		$participant->status                 = $status;
		$participant->weekly_summary_opt_out = $opt_out;
		$participant->weekly_feed_mode       = $mode;
		return $participant;
	}

	/**
	 * An email service whose audience is the given participants.
	 *
	 * @param Participant[]                      $participants Participants.
	 * @param FakeParticipantFeedRepository|null $feeds        Chosen feeds.
	 * @return EmailService
	 */
	private static function service( array $participants, $feeds = null ) {
		$service    = new EmailService();
		$repository = new class( $participants ) {
			/**
			 * Participants.
			 *
			 * @var Participant[]
			 */
			private $participants;

			/**
			 * Constructor.
			 *
			 * @param Participant[] $participants Participants.
			 */
			public function __construct( $participants ) {
				$this->participants = $participants;
			}

			/**
			 * All participants.
			 *
			 * @return Participant[]
			 */
			public function get_all() {
				return $this->participants;
			}
		};
		( new \ReflectionProperty( EmailService::class, 'participant_repository' ) )->setValue( $service, $repository );
		( new \ReflectionProperty( EmailService::class, 'participant_feed_repository' ) )->setValue( $service, $feeds ?? new FakeParticipantFeedRepository() );
		return $service;
	}

	/** Each participant is reported with its outcome and a safe reason code; results are unchanged. */
	public function test_reports_each_participant() {
		$reports      = array();
		$feeds        = new FakeParticipantFeedRepository();
		$feeds->feeds = array(
			1 => array( 1 ),
			2 => array( 1 ),
			3 => array( 1 ),
			4 => array( 1 ),
		);
		$results      = self::service(
			array(
				self::participant( 1, 'ann@example.test' ),
				self::participant( 2, 'bob@example.test', 'confirmed', true ),
				self::participant( 3, 'cy@example.test', 'pending' ),
				self::participant( 4, 'not-an-address' ),
			),
			$feeds
		)->send_bulk_custom_mail_to_all(
			'Weekly',
			'<p>Events</p>',
			true,
			array(),
			array(),
			EmailType::WEEKLY_SUMMARY,
			static function ( $event, array $recipient ) use ( &$reports ) {
				$reports[] = array( $event, $recipient['id'], $recipient['reason'] ?? '' );
			},
			1
		);

		$this->assertSame(
			array(
				array( 'sending', 1, '' ),
				array( 'sent', 1, '' ),
				array( 'skipped', 2, 'weekly_summary_opt_out' ),
				array( 'skipped', 3, 'consent_pending' ),
				array( 'rejected', 4, 'invalid_address' ),
			),
			$reports
		);
		$this->assertCount( 1, $results['sent'] );
		$this->assertCount( 2, $results['skipped'] );
		$this->assertCount( 1, $results['failed'] );
		$this->assertCount( 1, $GLOBALS['_fair_test_sent_emails'] );
	}

	/** The observer only sees the participant's ID, name and address. */
	public function test_reports_no_message_content() {
		$recipients   = array();
		$feeds        = new FakeParticipantFeedRepository();
		$feeds->feeds = array( 1 => array( 1 ) );
		self::service( array( self::participant( 1, 'ann@example.test' ) ), $feeds )->send_bulk_custom_mail_to_all(
			'Weekly',
			'<p>Events</p>',
			true,
			array(),
			array(),
			EmailType::WEEKLY_SUMMARY,
			static function ( $event, array $recipient ) use ( &$recipients ) {
				$recipients[] = $recipient;
			},
			1
		);

		$this->assertSame(
			array(
				'id'    => 1,
				'name'  => 'Person 1',
				'email' => 'ann@example.test',
			),
			$recipients[0]
		);
	}

	/**
	 * Participants receive a feed's email only when they subscribed to it,
	 * whatever their marketing consent; confirmation and the weekly opt-out
	 * still apply. A legacy participant not converted yet receives nothing
	 * without explicit feeds. Participants it is not meant for are not
	 * reported.
	 */
	public function test_feed_email_goes_to_its_subscribers_only() {
		$feeds        = new FakeParticipantFeedRepository();
		$feeds->feeds = array(
			2 => array( 1 ),
			3 => array( 2 ),
			4 => array( 1, 2 ),
			5 => array( 1 ),
			6 => array( 1 ),
			8 => array( 1 ),
			9 => array( 1 ),
		);
		$participants = array(
			self::participant( 1, 'all@example.test', 'confirmed', false, WeeklyFeeds::LEGACY_MODE_ALL ),
			self::participant( 2, 'a@example.test' ),
			self::participant( 3, 'b@example.test' ),
			self::participant( 4, 'ab@example.test' ),
			self::participant( 5, 'opted-out@example.test', 'confirmed', true ),
			self::participant( 6, 'pending@example.test', 'pending', false, WeeklyFeeds::MODE_SELECTED, 'minimal' ),
			self::participant( 7, 'none@example.test' ),
			self::participant( 8, 'feeds-only@example.test', 'confirmed', false, WeeklyFeeds::MODE_SELECTED, 'minimal' ),
			self::participant( 9, 'declined@example.test', 'confirmed', false, WeeklyFeeds::MODE_SELECTED, 'declined' ),
		);
		$reports      = array();
		$observer     = static function ( $event, array $recipient ) use ( &$reports ) {
			$reports[] = array( $event, $recipient['id'], $recipient['reason'] ?? '' );
		};

		self::service( $participants, $feeds )->send_bulk_custom_mail_to_all( 'Weekly', '<p>A</p>', true, array(), array(), EmailType::WEEKLY_SUMMARY, $observer, 1 );

		$this->assertSame(
			array(
				array( 'sending', 2, '' ),
				array( 'sent', 2, '' ),
				array( 'sending', 4, '' ),
				array( 'sent', 4, '' ),
				array( 'skipped', 5, 'weekly_summary_opt_out' ),
				array( 'skipped', 6, 'consent_pending' ),
				array( 'sending', 8, '' ),
				array( 'sent', 8, '' ),
				array( 'sending', 9, '' ),
				array( 'sent', 9, '' ),
			),
			$reports
		);

		$reports = array();
		self::service( $participants, $feeds )->send_bulk_custom_mail_to_all( 'Weekly', '<p>B</p>', true, array(), array(), EmailType::WEEKLY_SUMMARY, $observer, 2 );

		$this->assertSame( array( 3, 4 ), array_values( array_unique( array_column( $reports, 1 ) ) ) );

		$reports = array();
		self::service( $participants, $feeds )->send_bulk_custom_mail_to_all( 'Weekly', '<p>New</p>', true, array(), array(), EmailType::WEEKLY_SUMMARY, $observer, 3 );

		$this->assertSame( array(), $reports, 'A newly created feed reaches nobody until someone subscribes.' );
	}

	/** An email whose feed is unknown, missing or invalid reaches nobody, legacy participants included. */
	public function test_unknown_feed_reaches_nobody() {
		$feeds        = new FakeParticipantFeedRepository();
		$feeds->feeds = array( 2 => array( 1 ) );
		$participants = array(
			self::participant( 1, 'all@example.test', 'confirmed', false, WeeklyFeeds::LEGACY_MODE_ALL ),
			self::participant( 2, 'a@example.test' ),
		);

		foreach ( array( WeeklyDigestMailer::UNKNOWN_FEED, null, -4 ) as $feed_id ) {
			$results = self::service( $participants, $feeds )->send_bulk_custom_mail_to_all( 'Weekly', '<p>Events</p>', false, array(), array(), EmailType::WEEKLY_SUMMARY, null, $feed_id );

			$this->assertSame( array(), $results['sent'], var_export( $feed_id, true ) ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_var_export -- assertion message.
			$this->assertSame( array(), $results['skipped'] );
		}
		$this->assertCount( 0, $GLOBALS['_fair_test_sent_emails'] );
	}

	/** Feed subscriptions never grant general marketing emails. */
	public function test_marketing_send_still_needs_marketing_consent() {
		$feeds        = new FakeParticipantFeedRepository();
		$feeds->feeds = array( 1 => array( 1 ) );
		$results      = self::service(
			array(
				self::participant( 1, 'feeds-only@example.test', 'confirmed', false, WeeklyFeeds::MODE_SELECTED, 'minimal' ),
				self::participant( 2, 'marketing@example.test' ),
			),
			$feeds
		)->send_bulk_custom_mail_to_all( 'News', '<p>News</p>', true, array(), array(), EmailType::MARKETING );

		$this->assertSame( array( 'marketing@example.test' ), $results['sent'] );
		$this->assertCount( 1, $results['skipped'] );
	}

	/** Without a feed ID the feed send refuses, rather than reaching everyone. */
	public function test_feed_send_requires_a_feed() {
		$this->assertTrue( method_exists( WeeklyDigestMailer::class, 'send_to_feed_subscribers_reporting' ) );

		$this->expectException( \InvalidArgumentException::class );
		WeeklyDigestMailer::send_to_feed_subscribers_reporting( 0, 'Weekly', '<p>Events</p>', static function () {} );
	}

	/** Fair Events detects the reporting send by its method. */
	public function test_exposes_the_reporting_send() {
		$this->assertTrue( method_exists( WeeklyDigestMailer::class, 'send_to_subscribers_reporting' ) );
	}
}
