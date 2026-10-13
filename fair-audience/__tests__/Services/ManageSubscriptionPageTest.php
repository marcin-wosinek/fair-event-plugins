<?php
/**
 * ManageSubscriptionPage request handling tests.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairAudience\Services\ManageSubscriptionPage;
use FairAudience\Services\ManageSubscriptionToken;

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
	 * Seed two ordinary participants.
	 */
	protected function setUp(): void {
		$this->participants       = array(
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
		$this->anonymized         = array();
		$this->anonymize_succeeds = true;
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
			}
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
	 * The explanation names what is deleted and what stays, and never ends up empty.
	 */
	public function test_deletion_scope_lists_changed_and_kept_records() {
		$scope = ManageSubscriptionPage::deletion_scope();

		$this->assertNotEmpty( $scope['changed'] );
		$this->assertNotEmpty( $scope['kept'] );
		$this->assertStringContainsString( 'payment records are kept', implode( ' ', $scope['kept'] ) );
	}
}
