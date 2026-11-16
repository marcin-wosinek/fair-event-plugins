<?php
/**
 * Tests for the shared signed-link token envelope (#2336).
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Shared;

use FairAudience\Tests\Fixtures\LegacySignedLink;
use FairEventsShared\Security\SignedLinkToken;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once dirname( __DIR__ ) . '/fixtures/legacy-signed-link.php';

/**
 * Exercises the envelope directly, against tokens built independently with
 * the algorithm the link features used before they shared it.
 */
class SignedLinkTokenTest extends TestCase {

	private const CONTEXT = 'fair_audience_participant_';

	/**
	 * Restore the default salt stub.
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_salt'] );
	}

	/**
	 * Encoding reproduces a literal token issued before #2336.
	 */
	public function test_encode_matches_a_literal_legacy_token(): void {
		$this->assertSame(
			'MTI6MzQ6YmQ2NmZmYmM4MmVhNjFhZTg5MGI5YjA2MWJkNGI4NDZjMWJiZTY0OThhYmVhN2NlMjQ3N2MzMTdjOWFjODExMg',
			SignedLinkToken::encode( self::CONTEXT, array( 12, 34 ) )
		);
	}

	/**
	 * Encoding matches the legacy algorithm for every base64 padding length.
	 */
	public function test_encode_matches_the_legacy_algorithm_for_padded_lengths(): void {
		foreach ( array( '1', '12', '123', '4567:0', 'hidden:0' ) as $data ) {
			$this->assertSame(
				LegacySignedLink::token( self::CONTEXT, $data ),
				SignedLinkToken::encode( self::CONTEXT, explode( ':', $data ) ),
				$data
			);
		}
	}

	/**
	 * A legacy token decodes to its payload fields.
	 */
	public function test_decode_accepts_a_legacy_token(): void {
		$this->assertSame(
			array( '12', '34' ),
			SignedLinkToken::decode( self::CONTEXT, LegacySignedLink::token( self::CONTEXT, '12:34' ), 2 )
		);
	}

	/**
	 * A token signed with another context is refused.
	 */
	public function test_decode_rejects_another_context(): void {
		$token = LegacySignedLink::token( 'fair_audience_subscription_', '12:34' );

		$this->assertNull( SignedLinkToken::decode( self::CONTEXT, $token, 2 ) );
	}

	/**
	 * Tokens are bound to the auth salt they were signed with.
	 */
	public function test_decode_rejects_a_changed_salt(): void {
		$token = SignedLinkToken::encode( self::CONTEXT, array( 12, 34 ) );

		$GLOBALS['_fair_test_salt'] = 'rotated-salt';

		$this->assertNull( SignedLinkToken::decode( self::CONTEXT, $token, 2 ) );
		$this->assertSame(
			array( '12', '34' ),
			SignedLinkToken::decode( self::CONTEXT, LegacySignedLink::token( self::CONTEXT, '12:34', 'rotated-salt' ), 2 )
		);
	}

	/**
	 * An edited payload no longer matches its signature.
	 */
	public function test_decode_rejects_a_tampered_payload(): void {
		$signature = hash_hmac( 'sha256', '12:34', self::CONTEXT . 'test-salt' );

		$this->assertNull( SignedLinkToken::decode( self::CONTEXT, LegacySignedLink::url_safe( '13:34:' . $signature ), 2 ) );
	}

	/**
	 * An edited or re-cased signature is refused.
	 */
	public function test_decode_rejects_a_tampered_signature(): void {
		$signature = hash_hmac( 'sha256', '12:34', self::CONTEXT . 'test-salt' );
		$tampered  = substr( $signature, 0, -1 ) . ( '0' === substr( $signature, -1 ) ? '1' : '0' );

		$this->assertNull( SignedLinkToken::decode( self::CONTEXT, LegacySignedLink::url_safe( '12:34:' . $tampered ), 2 ) );
		$this->assertNull( SignedLinkToken::decode( self::CONTEXT, LegacySignedLink::url_safe( '12:34:' . strtoupper( $signature ) ), 2 ) );
	}

	/**
	 * Tokens that are not a URL-safe base64 envelope.
	 *
	 * @return array<string, array{string}>
	 */
	public static function malformed_tokens(): array {
		$valid = LegacySignedLink::token( self::CONTEXT, '12:34' );

		return array(
			'empty'                => array( '' ),
			'standard base64 char' => array( 'ab+/' . $valid ),
			'padding'              => array( $valid . '=' ),
			'whitespace'           => array( ' ' . $valid ),
			'impossible length'    => array( 'A' ),
			'not base64 at all'    => array( '!!!!' ),
			'truncated'            => array( substr( $valid, 0, -3 ) ),
		);
	}

	/**
	 * Tokens that are not URL-safe base64 envelopes are refused.
	 *
	 * @param string $token Malformed token.
	 */
	#[DataProvider( 'malformed_tokens' )]
	public function test_decode_rejects_malformed_tokens( string $token ): void {
		$this->assertNull( SignedLinkToken::decode( self::CONTEXT, $token, 2 ) );
	}

	/**
	 * Missing, extra or unsigned fields are refused.
	 */
	public function test_decode_requires_the_expected_number_of_fields(): void {
		$this->assertNull( SignedLinkToken::decode( self::CONTEXT, LegacySignedLink::token( self::CONTEXT, '12' ), 2 ) );
		$this->assertNull( SignedLinkToken::decode( self::CONTEXT, LegacySignedLink::token( self::CONTEXT, '12:34:56' ), 2 ) );
		$this->assertNull( SignedLinkToken::decode( self::CONTEXT, LegacySignedLink::token( self::CONTEXT, '12:34' ), 1 ) );
		$this->assertNull( SignedLinkToken::decode( self::CONTEXT, LegacySignedLink::token( self::CONTEXT, '12:34' ), 0 ) );
		$this->assertNull( SignedLinkToken::decode( self::CONTEXT, LegacySignedLink::url_safe( '12' ), 1 ) );
	}

	/**
	 * ID fields and what parse_id() makes of them.
	 *
	 * @return array<string, array{string, int, int|null}>
	 */
	public static function id_fields(): array {
		return array(
			'positive'              => array( '42', 1, 42 ),
			'largest integer'       => array( (string) PHP_INT_MAX, 1, PHP_INT_MAX ),
			'zero sentinel allowed' => array( '0', 0, 0 ),
			'zero as record ID'     => array( '0', 1, null ),
			'negative'              => array( '-1', 0, null ),
			'plus sign'             => array( '+5', 1, null ),
			'leading zero'          => array( '05', 1, null ),
			'overflow'              => array( '99999999999999999999', 1, null ),
			'nonnumeric'            => array( 'abc', 1, null ),
			'numeric prefix'        => array( '5abc', 1, null ),
			'decimal'               => array( '5.0', 1, null ),
			'exponent'              => array( '1e3', 1, null ),
			'whitespace'            => array( ' 5', 1, null ),
			'trailing newline'      => array( "5\n", 1, null ),
			'empty'                 => array( '', 0, null ),
		);
	}

	/**
	 * Only canonical in-range decimal IDs are accepted.
	 *
	 * @param string   $value    Field value.
	 * @param int      $min      Smallest accepted ID.
	 * @param int|null $expected Expected result.
	 */
	#[DataProvider( 'id_fields' )]
	public function test_parse_id( string $value, int $min, ?int $expected ): void {
		$this->assertSame( $expected, SignedLinkToken::parse_id( $value, $min ) );
	}

	/**
	 * Payloads the envelope cannot hold unambiguously.
	 *
	 * @return array<string, array{array}>
	 */
	public static function unencodable_fields(): array {
		return array(
			'no fields'       => array( array() ),
			'empty field'     => array( array( 12, '' ) ),
			'separator field' => array( array( '12:34' ) ),
		);
	}

	/**
	 * Payloads that would be ambiguous in the envelope cannot be encoded.
	 *
	 * @param array $fields Payload fields.
	 */
	#[DataProvider( 'unencodable_fields' )]
	public function test_encode_rejects_fields_the_envelope_cannot_hold( array $fields ): void {
		$this->expectException( \InvalidArgumentException::class );

		SignedLinkToken::encode( self::CONTEXT, $fields );
	}

	/**
	 * Signing without a context is a programming error.
	 */
	public function test_an_empty_context_is_refused(): void {
		$this->expectException( \InvalidArgumentException::class );

		SignedLinkToken::decode( '', LegacySignedLink::token( '', '12' ), 1 );
	}
}
