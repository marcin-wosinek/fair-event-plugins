<?php
/**
 * RecipientResolver::can_receive_email() tests
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairAudience\Services\RecipientResolver;
use FairAudience\Services\EmailType;
use FairAudience\Models\Participant;

/**
 * Validates the consent gates that decide whether a participant receives a
 * marketing or weekly feed email. A pending double-opt-in subscriber must
 * not be treated as consented until they confirm; weekly feed emails do not
 * depend on general marketing consent.
 */
class RecipientResolverTest extends TestCase {

	/**
	 * Build a participant with the given email_profile/status.
	 *
	 * @param string $email_profile          'minimal' | 'marketing' | 'declined'.
	 * @param string $status                 'pending' | 'confirmed'.
	 * @param bool   $weekly_summary_opt_out Whether the participant opted out of the weekly summary.
	 * @return Participant
	 */
	private function participant( $email_profile, $status, $weekly_summary_opt_out = false ) {
		$participant                         = new Participant();
		$participant->email_profile          = $email_profile;
		$participant->status                 = $status;
		$participant->weekly_summary_opt_out = $weekly_summary_opt_out ? 1 : 0;
		return $participant;
	}

	/**
	 * MINIMAL emails are always allowed regardless of profile/status.
	 */
	public function test_minimal_email_always_allowed() {
		$resolver = new RecipientResolver();
		$this->assertTrue(
			$resolver->can_receive_email( $this->participant( 'marketing', 'pending' ), EmailType::MINIMAL )
		);
		$this->assertTrue(
			$resolver->can_receive_email( $this->participant( 'declined', 'confirmed' ), EmailType::MINIMAL )
		);
	}

	/**
	 * A confirmed marketing subscriber receives marketing email.
	 */
	public function test_marketing_confirmed_can_receive_marketing() {
		$resolver = new RecipientResolver();
		$this->assertTrue(
			$resolver->can_receive_email( $this->participant( 'marketing', 'confirmed' ), EmailType::MARKETING )
		);
	}

	/**
	 * A pending marketing subscriber (double opt-in not yet confirmed) must
	 * not receive marketing email.
	 */
	public function test_marketing_pending_cannot_receive_marketing() {
		$resolver = new RecipientResolver();
		$this->assertFalse(
			$resolver->can_receive_email( $this->participant( 'marketing', 'pending' ), EmailType::MARKETING )
		);
	}

	/**
	 * A minimal-profile participant never receives marketing email.
	 */
	public function test_minimal_profile_cannot_receive_marketing() {
		$resolver = new RecipientResolver();
		$this->assertFalse(
			$resolver->can_receive_email( $this->participant( 'minimal', 'confirmed' ), EmailType::MARKETING )
		);
	}

	/**
	 * A declined participant never receives marketing email.
	 */
	public function test_declined_cannot_receive_marketing() {
		$resolver = new RecipientResolver();
		$this->assertFalse(
			$resolver->can_receive_email( $this->participant( 'declined', 'confirmed' ), EmailType::MARKETING )
		);
	}

	/**
	 * A confirmed marketing subscriber who has not opted out receives the
	 * weekly summary.
	 */
	public function test_marketing_confirmed_not_opted_out_can_receive_weekly_summary() {
		$resolver = new RecipientResolver();
		$this->assertTrue(
			$resolver->can_receive_email( $this->participant( 'marketing', 'confirmed', false ), EmailType::WEEKLY_SUMMARY )
		);
	}

	/**
	 * A confirmed marketing subscriber who opted out of just the summary
	 * cannot receive it.
	 */
	public function test_marketing_confirmed_opted_out_cannot_receive_weekly_summary() {
		$resolver = new RecipientResolver();
		$this->assertFalse(
			$resolver->can_receive_email( $this->participant( 'marketing', 'confirmed', true ), EmailType::WEEKLY_SUMMARY )
		);
	}

	/**
	 * A summary opt-out is scoped to the summary only — the same participant
	 * still receives other marketing sends.
	 */
	public function test_weekly_summary_opt_out_does_not_affect_marketing() {
		$resolver    = new RecipientResolver();
		$participant = $this->participant( 'marketing', 'confirmed', true );
		$this->assertTrue( $resolver->can_receive_email( $participant, EmailType::MARKETING ) );
		$this->assertFalse( $resolver->can_receive_email( $participant, EmailType::WEEKLY_SUMMARY ) );
	}

	/**
	 * Weekly feed emails are independent of general marketing consent: a
	 * confirmed participant without it still receives the feeds they chose.
	 */
	public function test_weekly_summary_does_not_need_marketing_consent() {
		$resolver = new RecipientResolver();
		foreach ( array( 'minimal', 'declined' ) as $profile ) {
			$participant = $this->participant( $profile, 'confirmed', false );
			$this->assertTrue( $resolver->can_receive_email( $participant, EmailType::WEEKLY_SUMMARY ), $profile );
			$this->assertFalse( $resolver->can_receive_email( $participant, EmailType::MARKETING ), $profile );
		}
	}

	/**
	 * The weekly summary still needs a confirmed address and no opt-out,
	 * whatever the email profile.
	 */
	public function test_weekly_summary_needs_confirmation_and_no_opt_out() {
		$resolver = new RecipientResolver();
		foreach ( array( 'minimal', 'marketing' ) as $profile ) {
			$this->assertFalse( $resolver->can_receive_email( $this->participant( $profile, 'pending', false ), EmailType::WEEKLY_SUMMARY ), $profile );
			$this->assertFalse( $resolver->can_receive_email( $this->participant( $profile, 'confirmed', true ), EmailType::WEEKLY_SUMMARY ), $profile );
		}
	}

	/**
	 * Only a well-formed address counts as deliverable: a missing or
	 * malformed one must be reported instead of handed to the mailer.
	 */
	public function test_has_valid_email_rejects_missing_and_malformed_addresses() {
		$resolver    = new RecipientResolver();
		$participant = $this->participant( 'marketing', 'confirmed' );

		$participant->email = 'jane@example.test';
		$this->assertTrue( $resolver->has_valid_email( $participant ) );

		foreach ( array( '', null, 'not-an-email', 'jane@', '@example.test' ) as $email ) {
			$participant->email = $email;
			$this->assertFalse( $resolver->has_valid_email( $participant ), 'Address: ' . $email );
		}
	}
}
