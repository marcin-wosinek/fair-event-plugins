<?php
/**
 * TransactionParticipantLink participant resolution tests.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairAudience\Services\TransactionParticipantLink;

/**
 * A transaction is attributed only when every signup it pays for names the
 * same participant.
 */
class TransactionParticipantLinkTest extends TestCase {

	/**
	 * Build signup rows with the given participant IDs.
	 *
	 * @param array $participant_ids Participant ID (or null) per row.
	 * @return object[]
	 */
	private function signups( array $participant_ids ) {
		return array_map(
			static function ( $participant_id ) {
				return (object) array( 'participant_id' => $participant_id );
			},
			$participant_ids
		);
	}

	/**
	 * One signup with a participant establishes it.
	 */
	public function test_single_signup_names_its_participant() {
		$this->assertSame( 7, TransactionParticipantLink::participant_for_signups( $this->signups( array( '7' ) ) ) );
	}

	/**
	 * A shared series purchase attributes to its one purchaser.
	 */
	public function test_signups_agreeing_on_a_participant_name_it() {
		$this->assertSame( 7, TransactionParticipantLink::participant_for_signups( $this->signups( array( 7, 7, 7 ) ) ) );
	}

	/**
	 * Signups naming different participants establish none.
	 */
	public function test_conflicting_signups_name_nobody() {
		$this->assertSame( 0, TransactionParticipantLink::participant_for_signups( $this->signups( array( 7, 8 ) ) ) );
	}

	/**
	 * A signup without a participant makes the purchase ambiguous.
	 */
	public function test_a_signup_without_participant_names_nobody() {
		$this->assertSame( 0, TransactionParticipantLink::participant_for_signups( $this->signups( array( 7, null ) ) ) );
		$this->assertSame( 0, TransactionParticipantLink::participant_for_signups( $this->signups( array( null ) ) ) );
	}

	/**
	 * No signups name nobody.
	 */
	public function test_no_signups_name_nobody() {
		$this->assertSame( 0, TransactionParticipantLink::participant_for_signups( array() ) );
	}
}
