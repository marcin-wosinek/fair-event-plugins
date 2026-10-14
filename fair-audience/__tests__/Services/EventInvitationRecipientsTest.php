<?php
/**
 * EmailService event-invitation recipient resolution tests
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairAudience\Services\EmailService;
use FairAudience\Models\Participant;

/**
 * The invitation preview and the send share one resolution, so the summary
 * an organizer confirms matches what is sent: participants are deduplicated
 * across direct picks and groups, and each one left out is counted under
 * exactly one reason. Repositories are replaced by in-memory fakes; no
 * database is involved.
 */
class EventInvitationRecipientsTest extends TestCase {

	/**
	 * Participants by ID.
	 *
	 * @var Participant[]
	 */
	private $participants = array();

	/**
	 * Reset recorded mail and the event post before each test.
	 */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_sent_emails'] = array();
		$GLOBALS['_fair_test_posts']       = array(
			5 => (object) array(
				'ID'         => 5,
				'post_title' => 'Community Meetup',
			),
		);

		$this->participants = array(
			1 => $this->participant( 1, 'Ada', 'ada@example.test', 'marketing', 'confirmed' ),
			2 => $this->participant( 2, 'Bo', 'bo@example.test', 'marketing', 'confirmed' ),
			3 => $this->participant( 3, 'Cy', 'cy@example.test', 'declined', 'confirmed' ),
			4 => $this->participant( 4, 'Di', 'di@example.test', 'marketing', 'confirmed' ),
			5 => $this->participant( 5, 'Ed', 'not-an-email', 'marketing', 'confirmed' ),
			6 => $this->participant( 6, 'Fay', 'fay@example.test', 'marketing', 'pending' ),
		);
	}

	/**
	 * Clear the event post.
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_posts'] );
		parent::tearDown();
	}

	/**
	 * Build a participant.
	 *
	 * @param int    $id            ID.
	 * @param string $name          Name.
	 * @param string $email         Email.
	 * @param string $email_profile Email profile.
	 * @param string $status        Status.
	 * @return Participant
	 */
	private function participant( $id, $name, $email, $email_profile, $status ) {
		$participant                = new Participant();
		$participant->id            = $id;
		$participant->name          = $name;
		$participant->email         = $email;
		$participant->email_profile = $email_profile;
		$participant->status        = $status;
		return $participant;
	}

	/**
	 * An EmailService reading from in-memory repositories.
	 *
	 * @param array $groups        Group ID => member participant IDs.
	 * @param array $signups_by_id Event date ID => [participant ID => label].
	 * @return EmailService
	 */
	private function service( array $groups, array $signups_by_id = array() ) {
		$service      = new EmailService();
		$participants = $this->participants;

		$this->set_private(
			$service,
			'participant_repository',
			new class( $participants ) {
				/**
				 * Participants by ID.
				 *
				 * @var array
				 */
				private $rows;

				/**
				 * Constructor.
				 *
				 * @param array $rows Participants by ID.
				 */
				public function __construct( $rows ) {
					$this->rows = $rows;
				}

				/**
				 * Find one participant.
				 *
				 * @param int $id Participant ID.
				 * @return Participant|null
				 */
				public function get_by_id( $id ) {
					return $this->rows[ $id ] ?? null;
				}
			}
		);

		$this->set_private(
			$service,
			'group_participant_repository',
			new class( $groups ) {
				/**
				 * Members by group.
				 *
				 * @var array
				 */
				private $groups;

				/**
				 * Constructor.
				 *
				 * @param array $groups Members by group.
				 */
				public function __construct( $groups ) {
					$this->groups = $groups;
				}

				/**
				 * Members of one group.
				 *
				 * @param int $group_id Group ID.
				 * @return object[]
				 */
				public function get_by_group( $group_id ) {
					return array_map(
						function ( $id ) {
							return (object) array( 'participant_id' => $id );
						},
						$this->groups[ $group_id ] ?? array()
					);
				}
			}
		);

		$this->set_private(
			$service,
			'event_participant_repository',
			new class( $signups_by_id ) {
				/**
				 * Labels by event date.
				 *
				 * @var array
				 */
				private $dates;

				/**
				 * Constructor.
				 *
				 * @param array $dates Labels by event date.
				 */
				public function __construct( $dates ) {
					$this->dates = $dates;
				}

				/**
				 * Audience of one date.
				 *
				 * @param int $event_date_id Event date ID.
				 * @return object[]
				 */
				public function get_by_event_date( $event_date_id ) {
					$rows = array();
					foreach ( $this->dates[ $event_date_id ] ?? array() as $id => $label ) {
						$rows[] = (object) array(
							'participant_id' => $id,
							'label'          => $label,
						);
					}
					return $rows;
				}
			}
		);

		return $service;
	}

	/**
	 * Replace a private property.
	 *
	 * @param object $target Object.
	 * @param string $name   Property name.
	 * @param mixed  $value  Value.
	 */
	private function set_private( $target, $name, $value ) {
		$property = new \ReflectionProperty( EmailService::class, $name );
		if ( PHP_VERSION_ID < 80100 ) {
			$property->setAccessible( true );
		}
		$property->setValue( $target, $value );
	}

	/**
	 * Reasons of the excluded entries, by participant ID.
	 *
	 * @param array $resolved Resolution.
	 * @return array
	 */
	private function reasons( $resolved ) {
		$reasons = array();
		foreach ( $resolved['excluded'] as $excluded ) {
			$reasons[ $excluded['participant_id'] ] = $excluded['reason'];
		}
		return $reasons;
	}

	/**
	 * Overlapping groups and direct picks count each person once.
	 */
	public function test_overlapping_groups_and_people_are_deduplicated(): void {
		$service = $this->service(
			array(
				10 => array( 1, 2, 3 ),
				11 => array( 2, 3, 4 ),
			)
		);

		$resolved = $service->resolve_event_invitation_recipients( 5, array( 1, 4 ), array( 10, 11 ), true, 20 );

		$this->assertSame( 6, $resolved['group_membership_count'] );
		$this->assertSame( 4, $resolved['candidate_count'] );
		// Direct picks first, then group members not already picked.
		$this->assertSame(
			array( 1, 4, 2 ),
			array_map(
				function ( $p ) {
					return $p->id;
				},
				$resolved['eligible']
			)
		);
		$this->assertSame(
			array( 3 => EmailService::INVITATION_EXCLUDED_NO_CONSENT ),
			$this->reasons( $resolved )
		);
	}

	/**
	 * Each person left out is counted under one reason, signups first.
	 */
	public function test_each_excluded_person_has_one_reason(): void {
		$service = $this->service(
			array(),
			array(
				20 => array(
					3 => 'signed_up',
					2 => 'interested',
				),
			)
		);

		$resolved = $service->resolve_event_invitation_recipients( 5, array( 2, 3, 5, 6, 99 ), array(), true, 20 );

		$this->assertSame( 5, $resolved['candidate_count'] );
		$this->assertCount( 1, $resolved['eligible'] );
		$this->assertSame( 2, $resolved['eligible'][0]->id );
		$this->assertSame(
			array(
				3  => EmailService::INVITATION_EXCLUDED_SIGNED_UP,
				5  => EmailService::INVITATION_EXCLUDED_INVALID_EMAIL,
				6  => EmailService::INVITATION_EXCLUDED_NO_CONSENT,
				99 => EmailService::INVITATION_EXCLUDED_UNAVAILABLE,
			),
			$this->reasons( $resolved )
		);
	}

	/**
	 * A signup to a sibling date in the series does not exclude anyone.
	 */
	public function test_signups_are_scoped_to_the_invited_date(): void {
		$service = $this->service(
			array(),
			array( 21 => array( 1 => 'signed_up' ) )
		);

		$resolved = $service->resolve_event_invitation_recipients( 5, array( 1 ), array(), true, 20 );

		$this->assertCount( 1, $resolved['eligible'] );
		$this->assertSame( array(), $resolved['excluded'] );
	}

	/**
	 * Nobody selected resolves to nobody, without errors.
	 */
	public function test_empty_selection_resolves_to_nobody(): void {
		$service = $this->service( array( 10 => array() ) );

		$resolved = $service->resolve_event_invitation_recipients( 5, array(), array( 10 ), true, 20 );

		$this->assertSame( 0, $resolved['candidate_count'] );
		$this->assertSame( array(), $resolved['eligible'] );
		$this->assertSame( array(), $resolved['excluded'] );
	}

	/**
	 * Resolving sends nothing.
	 */
	public function test_resolution_sends_no_mail(): void {
		$service = $this->service( array( 10 => array( 1, 2 ) ) );

		$service->resolve_event_invitation_recipients( 5, array(), array( 10 ), true, 20 );

		$this->assertSame( array(), $GLOBALS['_fair_test_sent_emails'] );
	}

	/**
	 * The send mails exactly the eligible people and reports the others as
	 * before: signups and consent as skipped, missing people and invalid
	 * addresses as failed.
	 */
	public function test_send_matches_the_resolution(): void {
		$service = $this->service(
			array(),
			array( 20 => array( 3 => 'signed_up' ) )
		);

		$results = $service->send_bulk_event_invitations( 5, '', array( 1, 2, 3, 5, 6, 99 ), array(), true, 20 );

		$this->assertSame( array( 'ada@example.test', 'bo@example.test' ), $results['sent'] );
		$this->assertSame(
			array( 'ada@example.test', 'bo@example.test' ),
			array_column( $GLOBALS['_fair_test_sent_emails'], 'to' )
		);
		$this->assertSame(
			array( 'cy@example.test', 'fay@example.test' ),
			array_column( $results['skipped'], 'email' )
		);
		$this->assertSame( 'Already signed up', $results['skipped'][0]['reason'] );
		$this->assertSame(
			array( 'Participant has no valid email address.', 'Participant not found.' ),
			array_column( $results['failed'], 'reason' )
		);
	}
}
