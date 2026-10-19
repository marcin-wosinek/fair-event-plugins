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
use PHPUnit\Framework\TestCase;

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
	 * @return Participant
	 */
	private static function participant( $id, $email, $status = 'confirmed', $opt_out = false ) {
		$participant                         = new Participant();
		$participant->id                     = $id;
		$participant->name                   = 'Person ' . $id;
		$participant->email                  = $email;
		$participant->email_profile          = 'marketing';
		$participant->status                 = $status;
		$participant->weekly_summary_opt_out = $opt_out;
		return $participant;
	}

	/**
	 * An email service whose audience is the given participants.
	 *
	 * @param Participant[] $participants Participants.
	 * @return EmailService
	 */
	private static function service( array $participants ) {
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
		return $service;
	}

	/** Each participant is reported with its outcome and a safe reason code; results are unchanged. */
	public function test_reports_each_participant() {
		$reports = array();
		$results = self::service(
			array(
				self::participant( 1, 'ann@example.test' ),
				self::participant( 2, 'bob@example.test', 'confirmed', true ),
				self::participant( 3, 'cy@example.test', 'pending' ),
				self::participant( 4, 'not-an-address' ),
			)
		)->send_bulk_custom_mail_to_all(
			'Weekly',
			'<p>Events</p>',
			true,
			array(),
			array(),
			EmailType::WEEKLY_SUMMARY,
			static function ( $event, array $recipient ) use ( &$reports ) {
				$reports[] = array( $event, $recipient['id'], $recipient['reason'] ?? '' );
			}
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
		$recipients = array();
		self::service( array( self::participant( 1, 'ann@example.test' ) ) )->send_bulk_custom_mail_to_all(
			'Weekly',
			'<p>Events</p>',
			true,
			array(),
			array(),
			EmailType::WEEKLY_SUMMARY,
			static function ( $event, array $recipient ) use ( &$recipients ) {
				$recipients[] = $recipient;
			}
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

	/** Fair Events detects the reporting send by its method. */
	public function test_exposes_the_reporting_send() {
		$this->assertTrue( method_exists( WeeklyDigestMailer::class, 'send_to_subscribers_reporting' ) );
	}
}
