<?php
/**
 * ManageSubscriptionPage request handling tests.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairAudience\Models\Participant;
use FairAudience\Services\ManageSubscriptionPage;
use FairAudience\Services\ManageSubscriptionToken;
use FairAudience\Services\WeeklyDigestMailer;
use FairAudience\Services\WeeklyFeeds;
use FairAudience\Tests\Services\Fakes\FakeParticipantFeedRepository;
use FairAudience\Tests\Services\Fakes\FakeWeeklyFeedCatalog;

require_once __DIR__ . '/fakes/FakeWeeklyFeedCatalog.php';
require_once __DIR__ . '/fakes/FakeParticipantFeedRepository.php';

/**
 * Deleting personal data needs the signed link, an explicit confirmed
 * request and the confirmation proof issued for that participant.
 */
class ManageSubscriptionPageTest extends TestCase {

	/**
	 * Participants the fake lookup knows, by ID.
	 *
	 * @var object[]
	 */
	private $participants = array();

	/**
	 * Participants passed to the fake anonymization.
	 *
	 * @var object[]
	 */
	private $anonymized = array();

	/**
	 * What the fake anonymization reports.
	 *
	 * @var bool
	 */
	private $anonymize_succeeds = true;

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
	 * Seed two ordinary participants.
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array(
			WeeklyDigestMailer::LEGACY_OPTION => array( 'enabled' => true ),
		);
		$this->feed_repository         = new FakeParticipantFeedRepository();
		$this->categories              = new class() {
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
				$this->stored[ $participant_id ] = $ids;
				return ! $this->fails;
			}
		};
		$this->participants            = array(
			7 => (object) array(
				'id'    => 7,
				'name'  => 'Ada',
				'email' => 'ada@example.test',
			),
			8 => (object) array(
				'id'    => 8,
				'name'  => 'Bo',
				'email' => 'bo@example.test',
			),
		);
		$this->anonymized              = array();
		$this->anonymize_succeeds      = true;
	}

	/**
	 * Page handler backed by the fakes.
	 *
	 * @return ManageSubscriptionPage
	 */
	private function page() {
		return new ManageSubscriptionPage(
			function ( $participant_id ) {
				return $this->participants[ $participant_id ] ?? null;
			},
			function ( $participant ) {
				$this->anonymized[] = $participant;
				if ( $this->anonymize_succeeds ) {
					$participant->name  = 'Deleted';
					$participant->email = '';
				}
				return $this->anonymize_succeeds;
			},
			new WeeklyFeeds( new FakeWeeklyFeedCatalog(), $this->feed_repository ),
			$this->categories
		);
	}

	/**
	 * A confirmed deletion request for a participant.
	 *
	 * @param int $proof_for Participant the proof is issued for.
	 * @return array POST fields.
	 */
	private function confirmed_post( int $proof_for ) {
		return array(
			'confirm_delete_my_data' => '1',
			'delete_confirmation'    => ManageSubscriptionPage::issue_confirmation_proof( $proof_for ),
		);
	}

	/**
	 * A plain view shows the page and issues a proof without deleting.
	 */
	public function test_viewing_the_page_deletes_nothing() {
		$page = $this->page()->handle( ManageSubscriptionToken::generate( 7 ) );

		$this->assertSame( ManageSubscriptionPage::VIEW_MANAGE, $page['view'] );
		$this->assertTrue( ManageSubscriptionPage::verify_confirmation_proof( $page['confirmation_proof'], 7 ) );
		$this->assertSame( array(), $this->anonymized );
	}

	/**
	 * The first request only opens the confirmation.
	 */
	public function test_opening_the_confirmation_deletes_nothing() {
		$page = $this->page()->handle( ManageSubscriptionToken::generate( 7 ), array( 'delete_my_data' => '1' ) );

		$this->assertSame( ManageSubscriptionPage::VIEW_CONFIRM_DELETE, $page['view'] );
		$this->assertNull( $page['redirect'] );
		$this->assertSame( array(), $this->anonymized );
	}

	/**
	 * A confirmed request with its proof deletes and redirects.
	 */
	public function test_confirmed_request_with_proof_deletes_and_redirects() {
		$page = $this->page()->handle( ManageSubscriptionToken::generate( 7 ), $this->confirmed_post( 7 ) );

		$this->assertSame( array( $this->participants[7] ), $this->anonymized );
		$this->assertSame( ManageSubscriptionToken::get_url( 7 ), $page['redirect'] );
	}

	/**
	 * An invalid or tampered link is refused whatever the request carries.
	 */
	public function test_invalid_token_is_refused() {
		$token = ManageSubscriptionToken::generate( 7 );
		// Participant 8's link with the ID swapped for 7: the signature no longer matches.
		// phpcs:disable WordPress.PHP.DiscouragedPHPFunctions -- the token format is base64.
		$other    = base64_decode( strtr( ManageSubscriptionToken::generate( 8 ), '-_', '+/' ) );
		$tampered = rtrim( strtr( base64_encode( '7' . substr( $other, 1 ) ), '+/', '-_' ), '=' );
		// phpcs:enable WordPress.PHP.DiscouragedPHPFunctions

		foreach ( array( 'not-a-token', '', $token . 'x', $tampered, ManageSubscriptionToken::generate( 0 ) ) as $bad_token ) {
			$page = $this->page()->handle( $bad_token, $this->confirmed_post( 7 ) );

			$this->assertSame( ManageSubscriptionPage::VIEW_INVALID, $page['view'] );
			$this->assertNull( $page['participant'] );
			$this->assertSame( '', $page['confirmation_proof'] );
		}

		$this->assertSame( array(), $this->anonymized );
	}

	/**
	 * A valid link for a participant that no longer exists is refused.
	 */
	public function test_unknown_participant_is_refused() {
		$page = $this->page()->handle( ManageSubscriptionToken::generate( 99 ), $this->confirmed_post( 99 ) );

		$this->assertSame( ManageSubscriptionPage::VIEW_INVALID, $page['view'] );
		$this->assertSame( array(), $this->anonymized );
	}

	/**
	 * A confirmed request without a usable proof deletes nothing.
	 */
	public function test_missing_or_malformed_proof_is_refused() {
		$proofs = array(
			array( 'confirm_delete_my_data' => '1' ),
			array(
				'confirm_delete_my_data' => '1',
				'delete_confirmation'    => '',
			),
			array(
				'confirm_delete_my_data' => '1',
				'delete_confirmation'    => 'nonsense',
			),
			array(
				'confirm_delete_my_data' => '1',
				'delete_confirmation'    => array( 'x' ),
			),
			array(
				'confirm_delete_my_data' => '1',
				'delete_confirmation'    => ( time() + 60 ) . '.' . str_repeat( 'a', 64 ),
			),
		);

		foreach ( $proofs as $post ) {
			$page = $this->page()->handle( ManageSubscriptionToken::generate( 7 ), $post );

			$this->assertSame( ManageSubscriptionPage::VIEW_MANAGE, $page['view'] );
			$this->assertSame( 400, $page['status'] );
			$this->assertSame( 'error', $page['message_type'] );
			$this->assertNotSame( '', $page['message'] );
			$this->assertNull( $page['redirect'] );
		}

		$this->assertSame( array(), $this->anonymized );
	}

	/**
	 * A proof issued for one participant does not confirm another's deletion.
	 */
	public function test_proof_for_another_participant_is_refused() {
		$page = $this->page()->handle( ManageSubscriptionToken::generate( 7 ), $this->confirmed_post( 8 ) );

		$this->assertSame( 400, $page['status'] );
		$this->assertSame( array(), $this->anonymized );
	}

	/**
	 * A proof stops working once its lifetime has passed.
	 */
	public function test_proof_expires() {
		$issued_at = 1000000;
		$proof     = ManageSubscriptionPage::issue_confirmation_proof( 7, $issued_at );

		$this->assertTrue( ManageSubscriptionPage::verify_confirmation_proof( $proof, 7, $issued_at + ManageSubscriptionPage::PROOF_LIFETIME ) );
		$this->assertFalse( ManageSubscriptionPage::verify_confirmation_proof( $proof, 7, $issued_at + ManageSubscriptionPage::PROOF_LIFETIME + 1 ) );
	}

	/**
	 * A proof whose expiry was pushed back no longer matches its signature.
	 */
	public function test_proof_with_extended_expiry_is_refused() {
		$issued_at        = 1000000;
		list( , $signed ) = explode( '.', ManageSubscriptionPage::issue_confirmation_proof( 7, $issued_at ), 2 );
		$extended         = ( $issued_at + 10 * ManageSubscriptionPage::PROOF_LIFETIME ) . '.' . $signed;

		$this->assertFalse( ManageSubscriptionPage::verify_confirmation_proof( $extended, 7, $issued_at ) );
	}

	/**
	 * A failed deletion is reported and can be tried again.
	 */
	public function test_failed_deletion_is_visible_and_retryable() {
		$this->anonymize_succeeds = false;

		$page = $this->page()->handle( ManageSubscriptionToken::generate( 7 ), $this->confirmed_post( 7 ) );

		$this->assertSame( ManageSubscriptionPage::VIEW_MANAGE, $page['view'] );
		$this->assertSame( 500, $page['status'] );
		$this->assertSame( 'error', $page['message_type'] );
		$this->assertNotSame( '', $page['message'] );
		$this->assertNull( $page['redirect'] );

		$this->anonymize_succeeds = true;
		$retry                    = $this->page()->handle(
			ManageSubscriptionToken::generate( 7 ),
			array(
				'confirm_delete_my_data' => '1',
				'delete_confirmation'    => $page['confirmation_proof'],
			)
		);

		$this->assertSame( ManageSubscriptionToken::get_url( 7 ), $retry['redirect'] );
		$this->assertCount( 2, $this->anonymized );
	}

	/**
	 * Repeating a deletion request on an anonymized profile does not delete again.
	 */
	public function test_repeat_request_does_not_delete_again() {
		$post = $this->confirmed_post( 7 );

		$this->page()->handle( ManageSubscriptionToken::generate( 7 ), $post );
		$repeat = $this->page()->handle( ManageSubscriptionToken::generate( 7 ), $post );
		$reopen = $this->page()->handle( ManageSubscriptionToken::generate( 7 ), array( 'delete_my_data' => '1' ) );

		$this->assertCount( 1, $this->anonymized );
		$this->assertSame( ManageSubscriptionToken::get_url( 7 ), $repeat['redirect'] );
		$this->assertSame( ManageSubscriptionToken::get_url( 7 ), $reopen['redirect'] );
	}

	/**
	 * An anonymized profile shows the outcome and no way to delete again.
	 */
	public function test_anonymized_profile_shows_the_outcome() {
		$this->page()->handle( ManageSubscriptionToken::generate( 7 ), $this->confirmed_post( 7 ) );

		$page = $this->page()->handle( ManageSubscriptionToken::generate( 7 ) );

		$this->assertSame( ManageSubscriptionPage::VIEW_DELETED, $page['view'] );
		$this->assertSame( 'success', $page['message_type'] );
		$this->assertSame( '', $page['confirmation_proof'] );
	}

	/**
	 * A marketing subscriber whose saves are counted, as participant 9.
	 *
	 * @param string $mode    Weekly feed mode.
	 * @param bool   $opt_out Weekly opt-out.
	 * @return Participant
	 */
	private function subscriber( $mode = WeeklyFeeds::MODE_ALL, $opt_out = false ) {
		$participant = new class() extends Participant {
			/**
			 * Number of saves.
			 *
			 * @var int
			 */
			public $saves = 0;

			/**
			 * Count the save.
			 *
			 * @return bool
			 */
			public function save() {
				++$this->saves;
				return true;
			}
		};

		$participant->id                     = 9;
		$participant->name                   = 'Cy';
		$participant->email                  = 'cy@example.test';
		$participant->email_profile          = 'marketing';
		$participant->status                 = 'confirmed';
		$participant->weekly_summary_opt_out = $opt_out ? 1 : 0;
		$participant->weekly_feed_mode       = $mode;
		$this->participants[9]               = $participant;

		return $participant;
	}

	/**
	 * Save the preferences form for participant 9.
	 *
	 * @param array $post POST fields.
	 * @return array Page state.
	 */
	private function save( array $post ) {
		$page = new ManageSubscriptionPage(
			function ( $participant_id ) {
				return $this->participants[ $participant_id ] ?? null;
			},
			null,
			new WeeklyFeeds( new FakeWeeklyFeedCatalog(), $this->feed_repository ),
			$this->categories
		);

		return $page->handle( ManageSubscriptionToken::generate( 9 ), $post );
	}

	/**
	 * The page shows the weekly switch, the offered feeds and the stored choice.
	 */
	public function test_shows_weekly_preferences_and_feeds() {
		$this->subscriber( WeeklyFeeds::MODE_SELECTED );
		$this->feed_repository->feeds[9] = array( 1, 3 );

		$page = $this->save( array() );

		$this->assertTrue( $page['weekly']['enabled'] );
		$this->assertTrue( $page['weekly']['feeds_available'] );
		$this->assertSame( array( 2, 1 ), array_column( $page['weekly']['feeds'], 'id' ) );
		$this->assertSame( array( 'Archive' ), array_column( $page['weekly']['unavailable'], 'name' ) );
		$this->assertSame( WeeklyFeeds::MODE_SELECTED, $page['preferences']['weekly_feed_mode'] );
		$this->assertSame( array( 1, 3 ), $page['preferences']['weekly_feeds'] );
	}

	/**
	 * Saving without the feed fields keeps an existing subscriber's scope.
	 */
	public function test_saving_other_preferences_keeps_the_legacy_scope() {
		$participant = $this->subscriber();

		$page = $this->save(
			array(
				'email_profile'      => 'marketing',
				'weekly_summary'     => 'on',
				'mailing_categories' => array( '4' ),
			)
		);

		$this->assertSame( 'success', $page['message_type'] );
		$this->assertSame( WeeklyFeeds::MODE_ALL, $participant->weekly_feed_mode );
		$this->assertArrayNotHasKey( 9, $this->feed_repository->feeds );
		$this->assertSame( array( 4 ), $this->categories->stored[9] );
	}

	/**
	 * Choosing feeds stores them, also when none is chosen.
	 */
	public function test_choosing_feeds_stores_the_selection() {
		$participant = $this->subscriber();

		$page = $this->save(
			array(
				'email_profile'    => 'marketing',
				'weekly_summary'   => 'on',
				'weekly_feed_mode' => 'selected',
				'weekly_feeds'     => array( '2', '1' ),
			)
		);

		$this->assertSame( 'success', $page['message_type'] );
		$this->assertSame( WeeklyFeeds::MODE_SELECTED, $participant->weekly_feed_mode );
		$this->assertSame( array( 1, 2 ), $this->feed_repository->feeds[9] );

		$this->save(
			array(
				'email_profile'    => 'marketing',
				'weekly_summary'   => 'on',
				'weekly_feed_mode' => 'selected',
			)
		);

		$this->assertSame( array(), $this->feed_repository->feeds[9] );
		$this->assertSame( WeeklyFeeds::MODE_SELECTED, $participant->weekly_feed_mode );
	}

	/**
	 * A feed that cannot be chosen rejects the save and changes nothing.
	 */
	public function test_unavailable_feed_rejects_the_whole_save() {
		$participant = $this->subscriber();

		$page = $this->save(
			array(
				'email_profile'    => 'marketing',
				'weekly_feed_mode' => 'selected',
				'weekly_feeds'     => array( '1', '3' ),
			)
		);

		$this->assertSame( 400, $page['status'] );
		$this->assertSame( 'error', $page['message_type'] );
		$this->assertSame( 0, $participant->saves );
		$this->assertSame( 0, $participant->weekly_summary_opt_out );
		$this->assertSame( WeeklyFeeds::MODE_ALL, $participant->weekly_feed_mode );
		$this->assertArrayNotHasKey( 9, $this->feed_repository->feeds );
		$this->assertArrayNotHasKey( 9, $this->categories->stored );
		$this->assertSame( WeeklyFeeds::MODE_SELECTED, $page['preferences']['weekly_feed_mode'], 'The submitted choice stays on the form.' );
	}

	/**
	 * Saving keeps chosen feeds that cannot be chosen now.
	 */
	public function test_saving_keeps_unavailable_feeds() {
		$this->subscriber( WeeklyFeeds::MODE_SELECTED );
		$this->feed_repository->feeds[9] = array( 3 );

		$this->save(
			array(
				'email_profile'    => 'marketing',
				'weekly_summary'   => 'on',
				'weekly_feed_mode' => 'selected',
				'weekly_feeds'     => array( '2' ),
			)
		);

		$this->assertSame( array( 2, 3 ), $this->feed_repository->feeds[9] );
	}

	/**
	 * Going back to every weekly email keeps the chosen feeds for later.
	 */
	public function test_choosing_all_weekly_emails_again() {
		$participant                     = $this->subscriber( WeeklyFeeds::MODE_SELECTED );
		$this->feed_repository->feeds[9] = array( 1 );

		$this->save(
			array(
				'email_profile'    => 'marketing',
				'weekly_summary'   => 'on',
				'weekly_feed_mode' => 'all',
			)
		);

		$this->assertSame( WeeklyFeeds::MODE_ALL, $participant->weekly_feed_mode );
		$this->assertSame( array( 1 ), $this->feed_repository->feeds[9] );
	}

	/**
	 * Essential emails only leaves the weekly preferences alone.
	 */
	public function test_minimal_profile_ignores_weekly_fields() {
		$participant = $this->subscriber( WeeklyFeeds::MODE_ALL, true );

		$this->save(
			array(
				'email_profile'    => 'minimal',
				'weekly_summary'   => 'on',
				'weekly_feed_mode' => 'selected',
				'weekly_feeds'     => array( '1' ),
			)
		);

		$this->assertSame( 'minimal', $participant->email_profile );
		$this->assertSame( 1, $participant->weekly_summary_opt_out );
		$this->assertSame( WeeklyFeeds::MODE_ALL, $participant->weekly_feed_mode );
		$this->assertArrayNotHasKey( 9, $this->feed_repository->feeds );
	}

	/**
	 * Failing to store preferences is reported, not reported as success.
	 */
	public function test_storage_failures_are_visible() {
		$this->subscriber();
		$this->feed_repository->fails = true;

		$page = $this->save(
			array(
				'email_profile'    => 'marketing',
				'weekly_summary'   => 'on',
				'weekly_feed_mode' => 'selected',
				'weekly_feeds'     => array( '1' ),
			)
		);
		$this->assertSame( 500, $page['status'] );
		$this->assertSame( 'error', $page['message_type'] );

		$this->feed_repository->fails = false;
		$this->categories->fails      = true;

		$page = $this->save( array( 'email_profile' => 'marketing' ) );
		$this->assertSame( 500, $page['status'] );
		$this->assertSame( 'error', $page['message_type'] );
	}

	/**
	 * The explanation names what is deleted and what stays, and never ends up empty.
	 */
	public function test_deletion_scope_lists_changed_and_kept_records() {
		$scope = ManageSubscriptionPage::deletion_scope();

		$this->assertNotEmpty( $scope['changed'] );
		$this->assertNotEmpty( $scope['kept'] );
		$this->assertStringContainsString( 'payment records are kept', implode( ' ', $scope['kept'] ) );
	}
}
