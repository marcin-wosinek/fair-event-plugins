<?php
/**
 * WhatsApp Cloud API client tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\WhatsApp;

use FairEventsExperimental\WhatsApp\Client;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Covers validation with pagination and account mismatch, template
 * filtering, send outcomes and the redaction of tokens, recipients and
 * Meta's own messages.
 */
class ClientTest extends TestCase {
	private const TOKEN = 'EAAGwhatsappAccessToken0123456789abcdef';
	private const WABA  = '100000000000001';
	private const PHONE = '200000000000002';

	/** Start with empty request logs and no queued answers. */
	protected function setUp(): void {
		$GLOBALS['_fair_test_remote_get_requests']  = array();
		$GLOBALS['_fair_test_remote_get_responses'] = array();
		$GLOBALS['_fair_test_remote_post_requests'] = array();
		unset( $GLOBALS['_fair_test_remote_post_response'] );
	}

	/** Leave no queued answer for other suites. */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_remote_post_response'] );
		$GLOBALS['_fair_test_remote_get_responses'] = array();
	}

	/**
	 * A simulated response.
	 *
	 * @param int          $status HTTP status.
	 * @param array|string $body   Body, JSON-encoded unless already a string.
	 * @return array Simulated response.
	 */
	private static function answer( $status, $body ) {
		return array(
			'response' => array( 'code' => $status ),
			'body'     => is_string( $body ) ? $body : wp_json_encode( $body ),
		);
	}

	/**
	 * A simulated Graph API error.
	 *
	 * @param int $status  HTTP status.
	 * @param int $code    Meta error code.
	 * @param int $subcode Meta error subcode.
	 * @return array Simulated Graph API error carrying secrets in its message.
	 */
	private static function graph_error( $status, $code, $subcode = 0 ) {
		return self::answer(
			$status,
			array(
				'error' => array(
					'message'       => 'Invalid token ' . self::TOKEN . ' for +34600000123',
					'code'          => $code,
					'error_subcode' => $subcode,
					'fbtrace_id'    => 'AbCtrace123',
				),
			)
		);
	}

	/**
	 * Queue answers for the next GET requests.
	 *
	 * @param array ...$responses Answers, in order.
	 * @return void
	 */
	private static function queue( ...$responses ) {
		$GLOBALS['_fair_test_remote_get_responses'] = $responses;
	}

	/**
	 * A client with the test token.
	 *
	 * @return Client
	 */
	private static function client() {
		return new Client( self::TOKEN );
	}

	/** Validation follows the cursor to find the sender on a later page. */
	public function test_validate_finds_the_sender_on_a_later_page() {
		self::queue(
			self::answer( 200, array( 'id' => self::WABA ) ),
			self::answer(
				200,
				array(
					'data'   => array( array( 'id' => '999' ) ),
					'paging' => array(
						'cursors' => array( 'after' => 'cursor2' ),
						'next'    => 'https://evil.example/next',
					),
				)
			),
			self::answer(
				200,
				array(
					'data' => array(
						array(
							'id'                   => self::PHONE,
							'display_phone_number' => '+34 600 000 002',
							'verified_name'        => '<b>Fair</b> Events',
							'quality_rating'       => 'GREEN',
							'throughput'           => array( 'level' => 'STANDARD' ),
						),
					),
				)
			)
		);

		$result = self::client()->validate( self::WABA, self::PHONE );

		$this->assertSame(
			array(
				'ok'     => true,
				'sender' => array(
					'display_phone_number' => '+34 600 000 002',
					'verified_name'        => 'Fair Events',
					'quality_rating'       => 'GREEN',
				),
			),
			$result
		);
		$requests = $GLOBALS['_fair_test_remote_get_requests'];
		$this->assertCount( 3, $requests );
		foreach ( $requests as $request ) {
			// The fixed host is used, never the `next` URL Meta returned.
			$this->assertStringStartsWith( 'https://graph.facebook.com/' . Client::GRAPH_API_VERSION . '/', $request['url'] );
			$this->assertSame( 'Bearer ' . self::TOKEN, $request['args']['headers']['Authorization'] );
			$this->assertStringNotContainsString( self::TOKEN, $request['url'] );
		}
		$this->assertStringContainsString( 'after=cursor2', $requests[2]['url'] );
	}

	/** A number the token can see but that belongs to another account is a mismatch. */
	public function test_validate_reports_a_number_of_another_account() {
		self::queue(
			self::answer( 200, array( 'id' => self::WABA ) ),
			self::answer( 200, array( 'data' => array( array( 'id' => '999' ) ) ) ),
			self::answer( 200, array( 'id' => self::PHONE ) )
		);

		$result = self::client()->validate( self::WABA, self::PHONE );

		$this->assertFalse( $result['ok'] );
		$this->assertSame( 'phone_number_mismatch', $result['code'] );
	}

	/** A number the token cannot see is reported as not found. */
	public function test_validate_reports_an_unknown_number() {
		self::queue(
			self::answer( 200, array( 'id' => self::WABA ) ),
			self::answer( 200, array( 'data' => array() ) ),
			self::graph_error( 400, 100, 33 )
		);

		$this->assertSame( 'phone_number_not_found', self::client()->validate( self::WABA, self::PHONE )['code'] );
	}

	/**
	 * Meta's errors map to actionable codes.
	 *
	 * @return array
	 */
	public static function validation_errors() {
		return array(
			'expired token'     => array( self::graph_error( 401, 190, 463 ), 'invalid_token', false ),
			'missing scope'     => array( self::graph_error( 403, 200 ), 'missing_permission', false ),
			'no account access' => array( self::graph_error( 403, 10 ), 'missing_permission', false ),
			'unknown account'   => array( self::graph_error( 400, 100, 33 ), 'waba_not_found', false ),
			'throttled'         => array( self::graph_error( 400, 80007 ), 'rate_limited', true ),
			'too many requests' => array( self::answer( 429, '' ), 'rate_limited', true ),
			'meta down'         => array( self::answer( 503, 'oops' ), 'meta_unavailable', true ),
			'other rejection'   => array( self::graph_error( 400, 100 ), 'rejected', false ),
		);
	}

	/**
	 * Validation failures are reduced to safe codes.
	 *
	 * @param array  $response  Meta's answer to the account lookup.
	 * @param string $code      Expected safe code.
	 * @param bool   $temporary Expected temporary flag.
	 */
	#[DataProvider( 'validation_errors' )]
	public function test_validate_maps_errors_without_leaking_secrets( $response, $code, $temporary ) {
		self::queue( $response );

		$result = self::client()->validate( self::WABA, self::PHONE );

		$this->assertFalse( $result['ok'] );
		$this->assertSame( $code, $result['code'] );
		$this->assertSame( $temporary, $result['temporary'] );
		$encoded = (string) wp_json_encode( $result );
		$this->assertStringNotContainsString( self::TOKEN, $encoded );
		$this->assertStringNotContainsString( '600000123', $encoded );
		$this->assertStringNotContainsString( 'Invalid token', $encoded );
	}

	/** Meta's numeric code and trace ID are kept for support. */
	public function test_failures_keep_meta_code_and_trace_id() {
		self::queue( self::graph_error( 401, 190 ) );

		$result = self::client()->validate( self::WABA, self::PHONE );

		$this->assertSame( 190, $result['meta_code'] );
		$this->assertSame( 'AbCtrace123', $result['trace_id'] );
	}

	/** A network failure is temporary. */
	public function test_validate_transport_failure() {
		self::queue( new \WP_Error( 'http_request_failed', 'timeout' ) );

		$result = self::client()->validate( self::WABA, self::PHONE );

		$this->assertSame( 'transport', $result['code'] );
		$this->assertTrue( $result['temporary'] );
	}

	/** Only approved templates without parameters are offered, sorted. */
	public function test_templates_offers_only_parameterless_approved_templates() {
		self::queue(
			self::answer(
				200,
				array(
					'data'   => array(
						array(
							'name'       => 'welcome',
							'language'   => 'es_ES',
							'status'     => 'APPROVED',
							'category'   => 'UTILITY',
							'components' => array(
								array(
									'type' => 'BODY',
									'text' => 'Hola',
								),
								array(
									'type'    => 'BUTTONS',
									'buttons' => array(
										array(
											'type' => 'URL',
											'url'  => 'https://example.test/',
										),
									),
								),
							),
						),
						array(
							'name'       => 'reminder',
							'language'   => 'en_US',
							'status'     => 'APPROVED',
							'components' => array(
								array(
									'type' => 'BODY',
									'text' => 'See you at {{1}}',
								),
							),
						),
						array(
							'name'       => 'poster',
							'language'   => 'en_US',
							'status'     => 'APPROVED',
							'components' => array(
								array(
									'type'   => 'HEADER',
									'format' => 'IMAGE',
								),
							),
						),
						array(
							'name'       => 'dynamic_link',
							'language'   => 'en_US',
							'status'     => 'APPROVED',
							'components' => array(
								array(
									'type'    => 'BUTTONS',
									'buttons' => array(
										array(
											'type' => 'URL',
											'url'  => 'https://example.test/{{1}}',
										),
									),
								),
							),
						),
						array(
							'name'       => 'login_code',
							'language'   => 'en_US',
							'status'     => 'APPROVED',
							'category'   => 'AUTHENTICATION',
							'components' => array(),
						),
						array(
							'name'       => 'draft',
							'language'   => 'en_US',
							'status'     => 'PENDING',
							'components' => array(),
						),
					),
					'paging' => array(
						'cursors' => array( 'after' => 'p2' ),
						'next'    => 'https://graph.facebook.com/next',
					),
				)
			),
			self::answer(
				200,
				array(
					'data' => array(
						array(
							'name'       => 'hello_world',
							'language'   => 'en_US',
							'status'     => 'APPROVED',
							'category'   => 'UTILITY',
							'components' => array(
								array(
									'type'   => 'HEADER',
									'format' => 'TEXT',
									'text'   => 'Hello World',
								),
							),
						),
					),
				)
			)
		);

		$result = self::client()->templates( self::WABA );

		$this->assertTrue( $result['ok'] );
		$this->assertSame(
			array(
				array(
					'name'     => 'hello_world',
					'language' => 'en_US',
					'category' => 'UTILITY',
				),
				array(
					'name'     => 'welcome',
					'language' => 'es_ES',
					'category' => 'UTILITY',
				),
			),
			$result['templates']
		);
		$this->assertStringContainsString( 'status=APPROVED', $GLOBALS['_fair_test_remote_get_requests'][0]['url'] );
	}

	/** An accepted send reports acceptance, not delivery, and sends exactly the template. */
	public function test_send_template_accepted() {
		$GLOBALS['_fair_test_remote_post_response'] = self::answer(
			200,
			array(
				'messages' => array(
					array(
						'id'             => 'wamid.ABC',
						'message_status' => 'accepted',
					),
				),
			)
		);

		$result = self::client()->send_template( self::PHONE, '34600000123', 'hello_world', 'en_US' );

		$this->assertSame(
			array(
				'ok'             => true,
				'outcome'        => 'accepted',
				'message_status' => 'accepted',
			),
			$result
		);
		$requests = $GLOBALS['_fair_test_remote_post_requests'];
		$this->assertCount( 1, $requests );
		$this->assertSame( 'https://graph.facebook.com/' . Client::GRAPH_API_VERSION . '/' . self::PHONE . '/messages', $requests[0]['url'] );
		$this->assertSame(
			array(
				'messaging_product' => 'whatsapp',
				'recipient_type'    => 'individual',
				'to'                => '34600000123',
				'type'              => 'template',
				'template'          => array(
					'name'     => 'hello_world',
					'language' => array( 'code' => 'en_US' ),
				),
			),
			json_decode( $requests[0]['args']['body'], true )
		);
	}

	/**
	 * Send outcomes: confirmed refusals, and answers that leave it unknown.
	 *
	 * @return array
	 */
	public static function send_failures() {
		return array(
			'timeout'             => array( new \WP_Error( 'http_request_failed', 'timeout' ), 'uncertain', 'transport' ),
			'no message id'       => array( self::answer( 200, array( 'messages' => array() ) ), 'uncertain', 'unconfirmed' ),
			'meta server error'   => array( self::answer( 500, '' ), 'uncertain', 'meta_unavailable' ),
			'not allowed'         => array( self::graph_error( 400, 131030 ), 'not_accepted', 'recipient_not_allowed' ),
			'template rejected'   => array( self::graph_error( 404, 132001 ), 'not_accepted', 'template_unavailable' ),
			'sender unregistered' => array( self::graph_error( 400, 133010 ), 'not_accepted', 'sender_not_registered' ),
		);
	}

	/**
	 * A failed send is reported, never retried.
	 *
	 * @param array|\WP_Error $response Meta's answer.
	 * @param string          $outcome  Expected outcome.
	 * @param string          $code     Expected safe code.
	 */
	#[DataProvider( 'send_failures' )]
	public function test_send_template_failures_are_sent_once( $response, $outcome, $code ) {
		$GLOBALS['_fair_test_remote_post_response'] = $response;

		$result = self::client()->send_template( self::PHONE, '34600000123', 'hello_world', 'en_US' );

		$this->assertFalse( $result['ok'] );
		$this->assertSame( $outcome, $result['outcome'] );
		$this->assertSame( $code, $result['code'] );
		$this->assertCount( 1, $GLOBALS['_fair_test_remote_post_requests'] );
		$this->assertStringNotContainsString( '600000123', (string) wp_json_encode( $result ) );
	}

	/** Recipients are reduced to digits; anything else is refused. */
	public function test_normalize_and_mask_recipient() {
		$this->assertSame( '34600123456', Client::normalize_recipient( '+34 600 123 456' ) );
		$this->assertSame( '34600123456', Client::normalize_recipient( '+34 (600) 123-456' ) );
		$this->assertSame( '', Client::normalize_recipient( '600 abc' ) );
		$this->assertSame( '', Client::normalize_recipient( '123' ) );
		$this->assertSame( '', Client::normalize_recipient( '+0034600123456' ) );
		$this->assertSame( '', Client::normalize_recipient( array( '34600123456' ) ) );
		$this->assertSame( '••••••••456', Client::mask_recipient( '34600123456' ) );
	}
}
