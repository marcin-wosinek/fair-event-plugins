<?php
/**
 * Compatibility and isolation of fee payment links (#2336).
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\Tests\Services;

use FairAudienceExperimental\Services\FeePaymentToken;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Fee payment links issued before the envelope was shared keep working, new
 * ones are identical, and other features' or broken tokens are refused.
 */
class FeePaymentTokenTest extends TestCase {

	private const CONTEXT = 'fair_audience_fee_payment_';

	/**
	 * A literal pre-#2336 token for fee payment 15 with the `test-salt` stub.
	 */
	private const LEGACY_15 = 'MTU6N2YwM2QxNDdjMWEzYjAyOGM5NGVlYTQxM2JmNWVlMDlhOTg1ODFhOWIyNzE1Mzk0NzVhMDk4MjllMjY5NDYwMA';

	/**
	 * Restore the default salt stub.
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_salt'] );
	}

	/**
	 * Token built with the pre-#2336 algorithm.
	 *
	 * @param string $context Signing context.
	 * @param string $data    Payload.
	 * @param string $salt    Auth salt.
	 * @return string
	 */
	private static function legacy( string $context, string $data, string $salt = 'test-salt' ): string {
		return self::url_safe( $data . ':' . hash_hmac( 'sha256', $data, $context . $salt ) );
	}

	/**
	 * URL-safe, unpadded base64.
	 *
	 * @param string $raw Raw envelope.
	 * @return string
	 */
	private static function url_safe( string $raw ): string {
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- builds legacy token fixtures.
		return rtrim( strtr( base64_encode( $raw ), '+/', '-_' ), '=' );
	}

	/**
	 * New fee payment links are identical to pre-#2336 ones.
	 */
	public function test_generated_token_is_unchanged(): void {
		$this->assertSame( self::LEGACY_15, FeePaymentToken::generate( 15 ) );
	}

	/**
	 * Fee payment links issued before #2336 are still accepted.
	 */
	public function test_legacy_token_is_accepted(): void {
		$this->assertSame( 15, FeePaymentToken::verify( self::LEGACY_15 ) );
		$this->assertSame( 123456, FeePaymentToken::verify( self::legacy( self::CONTEXT, '123456' ) ) );
	}

	/**
	 * The fee payment URL keeps its query parameter and home base.
	 */
	public function test_url_keeps_its_query_parameter_and_base(): void {
		$this->assertSame( 'https://example.com/?fee_payment=' . self::LEGACY_15, FeePaymentToken::get_url( 15 ) );
	}

	/**
	 * Tokens a fee payment link must refuse.
	 *
	 * @return array<string, array{string}>
	 */
	public static function rejected_tokens(): array {
		$signature = hash_hmac( 'sha256', '15', self::CONTEXT . 'test-salt' );

		$cases = array(
			'payload edited' => array( self::url_safe( '16:' . $signature ) ),
			'truncated'      => array( substr( self::LEGACY_15, 0, -2 ) ),
			'bad base64'     => array( '*' . self::LEGACY_15 ),
			'empty'          => array( '' ),
			'no signature'   => array( self::url_safe( '15' ) ),
			'extra field'    => array( self::url_safe( '15:' . $signature . ':x' ) ),
			'changed salt'   => array( self::legacy( self::CONTEXT, '15', 'old-salt' ) ),
			'zero ID'        => array( self::legacy( self::CONTEXT, '0' ) ),
			'negative ID'    => array( self::legacy( self::CONTEXT, '-15' ) ),
			'nonnumeric ID'  => array( self::legacy( self::CONTEXT, 'abc' ) ),
			'numeric prefix' => array( self::legacy( self::CONTEXT, '15abc' ) ),
			'leading zero'   => array( self::legacy( self::CONTEXT, '015' ) ),
			'overflowing ID' => array( self::legacy( self::CONTEXT, '99999999999999999999' ) ),
			'two fields'     => array( self::legacy( self::CONTEXT, '15:0' ) ),
		);

		foreach ( array( 'fair_audience_audience_signup_', 'fair_audience_subscription_', 'fair_audience_participant_', 'fair_audience_mailing_signup_' ) as $other ) {
			$cases[ "signed as {$other}" ] = array( self::legacy( $other, '15' ) );
		}

		return $cases;
	}

	/**
	 * Broken, invalid-ID or other-purpose tokens are refused.
	 *
	 * @param string $token Token to refuse.
	 */
	#[DataProvider( 'rejected_tokens' )]
	public function test_token_is_rejected( string $token ): void {
		$this->assertFalse( FeePaymentToken::verify( $token ) );
	}
}
