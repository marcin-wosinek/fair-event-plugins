<?php
/**
 * TelegramProvider unit tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\WeeklyNotifications;

use FairEventsExperimental\Settings\WeeklyNotificationSettings;
use FairEventsExperimental\WeeklyNotifications\TelegramProvider;
use PHPUnit\Framework\TestCase;

/**
 * Tests Telegram requests, result mapping and credential redaction.
 */
class TelegramProviderTest extends TestCase {
	private const TOKEN = '123456789:AAEabcdefghijklmnopqrstuvwxyz012345';

	/**
	 * Reset HTTP stubs and options.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options']              = array( WeeklyNotificationSettings::TOKEN_OPTION => self::TOKEN );
		$GLOBALS['_fair_test_remote_post_requests'] = array();
		$GLOBALS['_fair_test_remote_post_response'] = self::response( 200, array( 'ok' => true ) );
	}

	/**
	 * Build a fake HTTP response.
	 *
	 * @param int   $status HTTP status.
	 * @param array $body   JSON body.
	 * @return array
	 */
	private static function response( $status, array $body ) {
		return array(
			'response' => array( 'code' => $status ),
			'body'     => json_encode( $body ), // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode
		);
	}

	/**
	 * Settings with Telegram configured.
	 *
	 * @param bool $enabled Whether Telegram delivery is on.
	 * @return array
	 */
	private static function settings( $enabled = true ) {
		$settings                                      = WeeklyNotificationSettings::defaults();
		$settings['providers']['telegram']['enabled']  = $enabled;
		$settings['providers']['telegram']['chat_ids'] = array( '-1001234567890', '@fair_channel' );
		return $settings;
	}

	/** Sends plain text to sendMessage with link previews off. */
	public function test_send_posts_plain_text() {
		$result = ( new TelegramProvider() )->send( '@fair_channel', "Heading:\n* Mon, <b>Event</b>" );

		$this->assertSame( 'sent', $result['state'] );
		$request = $GLOBALS['_fair_test_remote_post_requests'][0];
		$body    = json_decode( $request['args']['body'], true );
		$this->assertSame( 'https://api.telegram.org/bot' . self::TOKEN . '/sendMessage', $request['url'] );
		$this->assertSame( '@fair_channel', $body['chat_id'] );
		$this->assertSame( "Heading:\n* Mon, <b>Event</b>", $body['text'] );
		$this->assertArrayNotHasKey( 'parse_mode', $body );
		$this->assertTrue( $body['link_preview_options']['is_disabled'] );
	}

	/** A Telegram refusal is a definite failure with its description. */
	public function test_refusal_is_failed_with_description() {
		$GLOBALS['_fair_test_remote_post_response'] = self::response(
			400,
			array(
				'ok'          => false,
				'error_code'  => 400,
				'description' => 'Bad Request: chat not found',
			)
		);

		$result = ( new TelegramProvider() )->send( '@missing_chat', 'Text' );

		$this->assertSame( 'failed', $result['state'] );
		$this->assertSame( 'http_400', $result['code'] );
		$this->assertSame( 'Bad Request: chat not found', $result['message'] );
	}

	/** Server errors and transport errors may have posted, so they are uncertain. */
	public function test_server_and_transport_errors_are_uncertain() {
		$GLOBALS['_fair_test_remote_post_response'] = self::response( 502, array() );
		$this->assertSame( 'uncertain', ( new TelegramProvider() )->send( '@fair_channel', 'Text' )['state'] );

		$GLOBALS['_fair_test_remote_post_response'] = new \WP_Error( 'http_request_failed', 'Operation timed out' );
		$result                                     = ( new TelegramProvider() )->send( '@fair_channel', 'Text' );
		$this->assertSame( 'uncertain', $result['state'] );
		$this->assertSame( 'transport_error', $result['code'] );
	}

	/** Error messages never contain the bot token. */
	public function test_errors_never_contain_the_token() {
		$GLOBALS['_fair_test_remote_post_response'] = new \WP_Error(
			'http_request_failed',
			'cURL error 28 for https://api.telegram.org/bot' . self::TOKEN . '/sendMessage and bot' . rawurlencode( self::TOKEN )
		);

		$result = ( new TelegramProvider() )->send( '@fair_channel', 'Text' );

		$this->assertStringNotContainsString( self::TOKEN, $result['message'] );
		$this->assertStringNotContainsString( 'AAEabcdefghijklmnopqrstuvwxyz012345', $result['message'] );
		$this->assertStringContainsString( '[redacted]', $result['message'] );
	}

	/** Without a token nothing is sent. */
	public function test_missing_token_sends_nothing() {
		$GLOBALS['_fair_test_options'] = array();

		$result = ( new TelegramProvider() )->send( '@fair_channel', 'Text' );

		$this->assertSame( 'failed', $result['state'] );
		$this->assertSame( array(), $GLOBALS['_fair_test_remote_post_requests'] );
	}

	/** Destinations are empty while Telegram is off, except for test sends. */
	public function test_destinations_respect_the_provider_toggle() {
		$provider = new TelegramProvider();

		$this->assertSame( array( '-1001234567890', '@fair_channel' ), $provider->destinations( self::settings() ) );
		$this->assertSame( array(), $provider->destinations( self::settings( false ) ) );
		$this->assertSame( array( '-1001234567890', '@fair_channel' ), $provider->destinations( self::settings( false ), true ) );

		$GLOBALS['_fair_test_options'] = array();
		$this->assertSame( array(), $provider->destinations( self::settings() ) );
	}

	/** Long summaries are split within Telegram's limit. */
	public function test_split_respects_the_telegram_limit() {
		$text  = "Heading:\n" . implode( "\n", array_fill( 0, 200, '* Mon, 18:00, A fairly long event title: https://example.com/events/some-event' ) );
		$parts = ( new TelegramProvider() )->split( $text );

		$this->assertGreaterThan( 1, count( $parts ) );
		foreach ( $parts as $part ) {
			$this->assertLessThanOrEqual( TelegramProvider::MESSAGE_LIMIT, mb_strlen( $part ) );
		}
	}
}
