<?php
/**
 * Compatibility and isolation of Fair Audience's signed-link features (#2336).
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use FairAudience\Services\AudienceSignupToken;
use FairAudience\Services\MailingSignupWeeklyPolicy;
use FairAudience\Services\ManageSubscriptionToken;
use FairAudience\Services\ParticipantToken;
use FairAudience\Tests\Fixtures\LegacySignedLink;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once dirname( __DIR__ ) . '/fixtures/legacy-signed-link.php';

/**
 * Each feature must keep accepting the links it issued before the envelope
 * was shared, produce identical new links, and refuse another feature's.
 */
class SignedLinkFeatureTokensTest extends TestCase {

	/**
	 * Signing contexts of every link feature, keyed by feature.
	 */
	private const CONTEXTS = array(
		'audience_signup' => 'fair_audience_audience_signup_',
		'subscription'    => 'fair_audience_subscription_',
		'participant'     => 'fair_audience_participant_',
		'mailing_signup'  => 'fair_audience_mailing_signup_',
		'fee_payment'     => 'fair_audience_fee_payment_',
	);

	/**
	 * Legacy-algorithm token.
	 *
	 * @param string $feature Key of self::CONTEXTS.
	 * @param string $data    Joined payload fields.
	 * @return string
	 */
	private static function legacy( string $feature, string $data ): string {
		return LegacySignedLink::token( self::CONTEXTS[ $feature ], $data );
	}

	/**
	 * Verify a token with a feature, normalizing its failure result to null.
	 *
	 * @param string $feature Key of self::CONTEXTS (fee_payment is tested in its own plugin).
	 * @param string $token   Token.
	 * @return mixed
	 */
	private static function verify( string $feature, string $token ) {
		switch ( $feature ) {
			case 'audience_signup':
				$result = AudienceSignupToken::verify( $token );
				break;
			case 'subscription':
				$result = ManageSubscriptionToken::verify( $token );
				break;
			case 'participant':
				$result = ParticipantToken::verify( $token );
				break;
			default:
				$result = MailingSignupWeeklyPolicy::verify( $token );
		}
		return false === $result ? null : $result;
	}

	/**
	 * Audience signup edit links are unchanged and still accepted.
	 */
	public function test_audience_signup_token_is_unchanged(): void {
		$legacy = 'NDI6ZDZhYjcyYWI0YzNmMGQ1YWNjZGQyM2VjMTc2ZTYxNTM2M2ZlZGZiMDk3NWRjNjg0NTYxY2U3MGFjNzlmYWI1Mg';

		$this->assertSame( $legacy, AudienceSignupToken::generate( 42 ) );
		$this->assertSame( 42, AudienceSignupToken::verify( $legacy ) );
	}

	/**
	 * Manage-subscription links are unchanged and still accepted.
	 */
	public function test_manage_subscription_token_is_unchanged(): void {
		$legacy = 'Nzo1MTA3M2NhNTEwOTFmNGRhN2UzN2M1ZDljYmIxYmYxZTlkZGMyM2U2ZjhmYmZhNjEyYTdiYmM0YzYwNjg1YjU2';

		$this->assertSame( $legacy, ManageSubscriptionToken::generate( 7 ) );
		$this->assertSame( 7, ManageSubscriptionToken::verify( $legacy ) );
	}

	/**
	 * Participant links are unchanged and still accepted.
	 */
	public function test_participant_token_is_unchanged(): void {
		$legacy = 'MTI6MzQ6YmQ2NmZmYmM4MmVhNjFhZTg5MGI5YjA2MWJkNGI4NDZjMWJiZTY0OThhYmVhN2NlMjQ3N2MzMTdjOWFjODExMg';

		$this->assertSame( $legacy, ParticipantToken::generate( 12, 34 ) );
		$this->assertSame(
			array(
				'participant_id' => 12,
				'event_date_id'  => 34,
			),
			ParticipantToken::verify( $legacy )
		);
	}

	/**
	 * Participant links without an event date keep the 0 sentinel.
	 */
	public function test_participant_token_keeps_the_no_event_date_sentinel(): void {
		$legacy = 'MTI6MDo4YTRkZTFlNzMxYTZiNjg2MGY1NzkyMmM3NjUwYzk3ZTY5NTAzOWU3NWIzODExNTM3MWEwZDYzNjNjNzllNGRm';

		$this->assertSame( $legacy, ParticipantToken::generate( 12 ) );
		$this->assertSame(
			array(
				'participant_id' => 12,
				'event_date_id'  => 0,
			),
			ParticipantToken::verify( $legacy )
		);
	}

	/**
	 * Mailing signup form configurations are unchanged and still accepted.
	 */
	public function test_mailing_signup_policy_token_is_unchanged(): void {
		$legacy = 'aGlkZGVuOjk6ZjY3ZjE1MTU1ZDliMWQ0YzcwMWEyMWViNDE0OTBiMThjMjJiYzUyZjdmNjQyYTBkYjEyM2RmNTdhMjdhYmM5Nw';
		$policy = MailingSignupWeeklyPolicy::from_attributes(
			array(
				'weeklyUpdate'  => 'checked',
				'feedSelection' => 'hidden',
				'feedId'        => 9,
			)
		);

		$this->assertSame( $legacy, MailingSignupWeeklyPolicy::sign( $policy ) );
		$this->assertSame(
			array(
				'feeds'   => 'hidden',
				'feed_id' => 9,
			),
			MailingSignupWeeklyPolicy::verify( $legacy )
		);
	}

	/**
	 * A multiselect form configuration verifies with feed ID 0.
	 */
	public function test_mailing_signup_policy_accepts_a_multiselect_form(): void {
		$this->assertSame(
			array(
				'feeds'   => 'multiselect',
				'feed_id' => 0,
			),
			MailingSignupWeeklyPolicy::verify( self::legacy( 'mailing_signup', 'multiselect:0' ) )
		);
	}

	/**
	 * Every feature paired with every other feature's context.
	 *
	 * @return array<string, array{string, string}>
	 */
	public static function wrong_purpose_pairs(): array {
		$payloads = array(
			'audience_signup' => '5',
			'subscription'    => '5',
			'participant'     => '5:0',
			'mailing_signup'  => 'hidden:5',
		);

		$pairs = array();
		foreach ( array_keys( $payloads ) as $verifier ) {
			foreach ( array_keys( self::CONTEXTS ) as $signer ) {
				if ( $signer === $verifier ) {
					continue;
				}
				$pairs[ "{$signer} token at {$verifier}" ] = array( $verifier, self::legacy( $signer, $payloads[ $verifier ] ) );
			}
		}
		return $pairs;
	}

	/**
	 * A feature refuses a token signed for any other feature.
	 *
	 * @param string $verifier Feature verifying the token.
	 * @param string $token    Token signed for another feature.
	 */
	#[DataProvider( 'wrong_purpose_pairs' )]
	public function test_a_token_signed_for_another_purpose_is_rejected( string $verifier, string $token ): void {
		$this->assertNull( self::verify( $verifier, $token ) );
	}

	/**
	 * The same ID gives each feature a distinct, non-interchangeable token.
	 */
	public function test_the_same_id_yields_a_different_token_per_purpose(): void {
		$tokens = array( AudienceSignupToken::generate( 5 ), ManageSubscriptionToken::generate( 5 ) );

		$this->assertNotSame( $tokens[0], $tokens[1] );
		$this->assertFalse( ManageSubscriptionToken::verify( $tokens[0] ) );
		$this->assertFalse( AudienceSignupToken::verify( $tokens[1] ) );
	}

	/**
	 * Correctly signed payloads a feature must still refuse.
	 *
	 * @return array<string, array{string, string}>
	 */
	public static function invalid_signed_payloads(): array {
		$cases = array();
		foreach ( array( 'audience_signup', 'subscription' ) as $feature ) {
			foreach ( array( '0', '-3', '05', 'abc', '5abc', '99999999999999999999', '', '5:6' ) as $data ) {
				$cases[ "{$feature} '{$data}'" ] = array( $feature, $data );
			}
		}
		foreach ( array( '0:1', '-1:0', '12:-1', '12:abc', '12:', 'x:0', '12', '12:0:0', '12:99999999999999999999' ) as $data ) {
			$cases[ "participant '{$data}'" ] = array( 'participant', $data );
		}
		foreach ( array( 'other:1', 'hidden:-1', 'hidden:abc', 'hidden', 'hidden:1:2', ':1', 'HIDDEN:1' ) as $data ) {
			$cases[ "mailing_signup '{$data}'" ] = array( 'mailing_signup', $data );
		}
		return $cases;
	}

	/**
	 * A correctly signed payload is still refused when its fields are invalid.
	 *
	 * @param string $feature Feature under test.
	 * @param string $data    Signed payload.
	 */
	#[DataProvider( 'invalid_signed_payloads' )]
	public function test_a_signed_but_invalid_payload_is_rejected( string $feature, string $data ): void {
		$this->assertNull( self::verify( $feature, self::legacy( $feature, $data ) ) );
	}

	/**
	 * Tampered or malformed tokens for each feature.
	 *
	 * @return array<string, array{string, string}>
	 */
	public static function tampered_tokens(): array {
		$valid = array(
			'audience_signup' => '42',
			'subscription'    => '7',
			'participant'     => '12:34',
			'mailing_signup'  => 'hidden:9',
		);

		$cases = array();
		foreach ( $valid as $feature => $data ) {
			$token     = self::legacy( $feature, $data );
			$signature = hash_hmac( 'sha256', $data, self::CONTEXTS[ $feature ] . 'test-salt' );
			$raw       = '1' . $data . ':' . $signature;

			$cases[ "{$feature} payload edited" ] = array( $feature, LegacySignedLink::url_safe( $raw ) );
			$cases[ "{$feature} truncated" ]      = array( $feature, substr( $token, 0, -2 ) );
			$cases[ "{$feature} bad base64" ]     = array( $feature, '*' . $token );
			$cases[ "{$feature} not base64" ]     = array( $feature, 'not a token' );
			$cases[ "{$feature} no signature" ]   = array( $feature, LegacySignedLink::url_safe( $data ) );
			$cases[ "{$feature} empty" ]          = array( $feature, '' );
			$cases[ "{$feature} changed salt" ]   = array( $feature, LegacySignedLink::token( self::CONTEXTS[ $feature ], $data, 'old-salt' ) );
			$cases[ "{$feature} extra field" ]    = array( $feature, LegacySignedLink::url_safe( $data . ':' . $signature . ':x' ) );
		}
		return $cases;
	}

	/**
	 * Tampered, truncated, re-salted or malformed tokens are refused.
	 *
	 * @param string $feature Feature under test.
	 * @param string $token   Broken token.
	 */
	#[DataProvider( 'tampered_tokens' )]
	public function test_a_tampered_or_malformed_token_is_rejected( string $feature, string $token ): void {
		$this->assertNull( self::verify( $feature, $token ) );
	}

	/**
	 * Link URLs keep their query parameters and permalink/home bases.
	 */
	public function test_urls_keep_their_query_parameters_and_bases(): void {
		$this->assertSame(
			'https://example.com/?p=3&edit_audience_signup=' . AudienceSignupToken::generate( 42 ),
			AudienceSignupToken::get_url( 42, 3 )
		);
		$this->assertSame(
			'https://example.com/?edit_audience_signup=' . AudienceSignupToken::generate( 42 ),
			AudienceSignupToken::get_url( 42, 0 )
		);
		$this->assertSame(
			'https://example.com/?manage_subscription=' . ManageSubscriptionToken::generate( 7 ),
			ManageSubscriptionToken::get_url( 7 )
		);
		$this->assertSame(
			'https://example.com/?p=3&participant_token=' . ParticipantToken::generate( 12, 34 ),
			ParticipantToken::get_url( 12, 34, 3 )
		);
		$this->assertSame(
			'https://example.com/?participant_token=' . ParticipantToken::generate( 12, 34 ),
			ParticipantToken::get_url( 12, 34 )
		);
	}
}
