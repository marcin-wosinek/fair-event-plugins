<?php
/**
 * Tests for the Instagram Graph API publishing calls.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Instagram;

use FairEventsExperimental\Instagram\GraphClient;
use PHPUnit\Framework\TestCase;

/**
 * Each answer is classified as done, refused or unknown, the token never
 * leaves the Authorization header, and nothing is retried here.
 */
class GraphClientTest extends TestCase {

	private const TOKEN = 'EAAtesttoken123';

	/** Reset the stubs. */
	protected function setUp(): void {
		$GLOBALS['_fair_test_remote_post_requests'] = array();
		$GLOBALS['_fair_test_remote_get_requests']  = array();
		$GLOBALS['_fair_test_remote_get_responses'] = array();
		unset( $GLOBALS['_fair_test_remote_post_response'] );
	}

	/**
	 * A client.
	 *
	 * @return GraphClient
	 */
	private function client() {
		return new GraphClient( self::TOKEN, '1784', 'https://graph.facebook.com/v27.0' );
	}

	/**
	 * A JSON response.
	 *
	 * @param int   $code HTTP status.
	 * @param array $body Body.
	 * @return array
	 */
	private static function response( $code, array $body ) {
		return array(
			'response' => array( 'code' => $code ),
			'body'     => wp_json_encode( $body ),
		);
	}

	/** Creates a container with the token in a header. */
	public function test_creates_a_container_with_the_token_in_a_header() {
		$GLOBALS['_fair_test_remote_post_response'] = self::response( 200, array( 'id' => '999' ) );

		$result = $this->client()->create_container( 'https://example.test/a.jpg', 'Caption' );

		$this->assertSame( 'ok', $result['state'] );
		$this->assertSame( '999', $result['id'] );
		$request = $GLOBALS['_fair_test_remote_post_requests'][0];
		$this->assertSame( 'https://graph.facebook.com/v27.0/1784/media', $request['url'] );
		$this->assertSame( 'Bearer ' . self::TOKEN, $request['args']['headers']['Authorization'] );
		$this->assertSame( 0, $request['args']['redirection'] );
		$this->assertStringNotContainsString( self::TOKEN, $request['url'] );
	}

	/** An unanswered container creation is a failure. */
	public function test_an_unanswered_container_creation_is_a_failure() {
		$GLOBALS['_fair_test_remote_post_response'] = new \WP_Error( 'http_request_failed', 'cURL error 28 access_token=' . self::TOKEN );

		$result = $this->client()->create_container( 'https://example.test/a.jpg', 'Caption' );

		$this->assertSame( 'failed', $result['state'] );
		$this->assertStringNotContainsString( self::TOKEN, $result['message'] );
	}

	/** Reads the container status. */
	public function test_reads_the_container_status() {
		$GLOBALS['_fair_test_remote_get_responses'] = array( self::response( 200, array( 'status_code' => 'FINISHED' ) ) );

		$result = $this->client()->container_status( '999' );

		$this->assertSame( 'ok', $result['state'] );
		$this->assertSame( 'FINISHED', $result['status_code'] );
	}

	/** Published media id is sent. */
	public function test_published_media_id_is_sent() {
		$GLOBALS['_fair_test_remote_post_response'] = self::response( 200, array( 'id' => '555' ) );

		$result = $this->client()->publish( '999' );

		$this->assertSame( 'sent', $result['state'] );
		$this->assertSame( '555', $result['id'] );
		$this->assertSame( array( 'creation_id' => '999' ), $GLOBALS['_fair_test_remote_post_requests'][0]['args']['body'] );
	}

	/** A meta refusal is a failure. */
	public function test_a_meta_refusal_is_a_failure() {
		$GLOBALS['_fair_test_remote_post_response'] = self::response(
			400,
			array(
				'error' => array(
					'code'    => 9007,
					'message' => 'Media ID is not available',
				),
			)
		);

		$result = $this->client()->publish( '999' );

		$this->assertSame( 'failed', $result['state'] );
		$this->assertSame( 'meta_9007', $result['code'] );
	}

	/**
	 * Answers that do not say whether the post went out.
	 *
	 * @return array[]
	 */
	public static function uncertain_answers() {
		return array(
			'transport error' => array( new \WP_Error( 'http_request_failed', 'timeout' ) ),
			'server error'    => array( self::response( 502, array() ) ),
			'unknown error'   => array(
				self::response(
					500,
					array(
						'error' => array(
							'code'    => 1,
							'message' => 'An unknown error occurred',
						),
					)
				),
			),
			'transient error' => array(
				self::response(
					400,
					array(
						'error' => array(
							'code'         => 4,
							'is_transient' => true,
						),
					)
				),
			),
			'no media ID'     => array( self::response( 200, array() ) ),
		);
	}

	/**
	 * An unclear publishing answer is uncertain.
	 *
	 * @param array|\WP_Error $response Response.
	 * @return void
	 */
	#[\PHPUnit\Framework\Attributes\DataProvider( 'uncertain_answers' )]
	public function test_an_unclear_publishing_answer_is_uncertain( $response ) {
		$GLOBALS['_fair_test_remote_post_response'] = $response;

		$this->assertSame( 'uncertain', $this->client()->publish( '999' )['state'] );
	}

	/** Only instagram permalinks are returned. */
	public function test_only_instagram_permalinks_are_returned() {
		$GLOBALS['_fair_test_remote_get_responses'] = array(
			self::response( 200, array( 'permalink' => 'https://www.instagram.com/p/ABC/' ) ),
			self::response( 200, array( 'permalink' => 'https://evil.test/p/ABC/' ) ),
		);

		$this->assertSame( 'https://www.instagram.com/p/ABC/', $this->client()->permalink( '555' ) );
		$this->assertSame( '', $this->client()->permalink( '555' ) );
	}
}
