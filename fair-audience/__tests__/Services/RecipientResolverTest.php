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
 * Validates the marketing-consent gate that decides whether a participant
 * receives a marketing email. A pending double-opt-in subscriber must not
 * be treated as consented until they confirm.
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
	 * A minimal-profile participant never receives the weekly summary,
	 * regardless of the opt-out flag.
	 */
	public function test_minimal_profile_cannot_receive_weekly_summary() {
		$resolver = new RecipientResolver();
		$this->assertFalse(
			$resolver->can_receive_email( $this->participant( 'minimal', 'confirmed', false ), EmailType::WEEKLY_SUMMARY )
		);
	}
}
