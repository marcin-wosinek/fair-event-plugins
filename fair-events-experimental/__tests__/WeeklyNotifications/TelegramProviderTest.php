<?php
/**
 * TelegramProvider unit tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\WeeklyNotifications;

use FairEventsExperimental\Settings\WeeklyNotificationSettings;
use FairEventsExperimental\WeeklyNotifications\MessageSplitter;
use FairEventsExperimental\WeeklyNotifications\TelegramConnector;
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
		putenv( TelegramConnector::CREDENTIAL_NAME ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
	}

	/**
	 * Clear the environment override.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		putenv( TelegramConnector::CREDENTIAL_NAME ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
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
		$this->assertSame( 'missing_token', $result['code'] );
		$this->assertSame( array(), $GLOBALS['_fair_test_remote_post_requests'] );
	}

	/** A malformed token is refused locally, without a request or its value in the result. */
	public function test_malformed_token_sends_nothing() {
		$GLOBALS['_fair_test_options'] = array( WeeklyNotificationSettings::TOKEN_OPTION => 'not-a-bot-token' );
		$provider                      = new TelegramProvider();

		$result = $provider->send( '@fair_channel', 'Text' );

		$this->assertSame( 'failed', $result['state'] );
		$this->assertSame( 'invalid_token', $result['code'] );
		$this->assertStringNotContainsString( 'not-a-bot-token', $result['message'] );
		$this->assertSame( array(), $GLOBALS['_fair_test_remote_post_requests'] );
		$this->assertSame( array(), $provider->destinations( self::settings() ) );
		$this->assertStringNotContainsString( 'not-a-bot-token', $provider->configuration_error( self::settings() ) );
		$this->assertNotSame( '', $provider->configuration_error( self::settings() ) );
		$this->assertSame( '', $provider->configuration_error( self::settings( false ) ) );
	}

	/** Each send uses the credential in effect at that moment. */
	public function test_send_uses_the_current_effective_credential() {
		$replacement = '987654321:AAEzyxwvutsrqponmlkjihgfedcba543210';
		$override    = '555555555:AAEoverrideoverrideoverrideoverride01';
		$provider    = new TelegramProvider();

		$provider->send( '@fair_channel', 'Text' );
		$GLOBALS['_fair_test_options'][ WeeklyNotificationSettings::TOKEN_OPTION ] = $replacement;
		$provider->send( '@fair_channel', 'Text' );
		putenv( TelegramConnector::CREDENTIAL_NAME . '=' . $override ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
		$provider->send( '@fair_channel', 'Text' );

		$this->assertSame(
			array(
				'https://api.telegram.org/bot' . self::TOKEN . '/sendMessage',
				'https://api.telegram.org/bot' . $replacement . '/sendMessage',
				'https://api.telegram.org/bot' . $override . '/sendMessage',
			),
			array_column( $GLOBALS['_fair_test_remote_post_requests'], 'url' )
		);
	}

	/** A token Telegram rejects is a definite failure, reported without the token. */
	public function test_rejected_token_is_failed_without_the_token() {
		$GLOBALS['_fair_test_remote_post_response'] = self::response(
			401,
			array(
				'ok'          => false,
				'error_code'  => 401,
				'description' => 'Unauthorized',
			)
		);

		$result = ( new TelegramProvider() )->send( '@fair_channel', 'Text' );

		$this->assertSame( 'failed', $result['state'] );
		$this->assertSame( 'http_401', $result['code'] );
		$this->assertSame( 'Unauthorized', $result['message'] );
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

	/**
	 * A summary with a number of linked events.
	 *
	 * @param int $count Number of events.
	 * @return array
	 */
	private static function summary( $count ) {
		$events = array();
		for ( $i = 1; $i <= $count; $i++ ) {
			$events[] = array(
				'when'  => 'Mon, 18:00',
				'title' => sprintf( 'A fairly long event title number %03d', $i ),
				'url'   => sprintf( 'https://example.com/events/%03d', $i ),
			);
		}

		return array(
			'title'  => 'Calendar',
			'url'    => 'https://example.com/calendar/',
			'range'  => '28 Sep – 4 Oct 2026',
			'events' => $events,
		);
	}

	/** Formatting is sent as entities on plain text, never as parse_mode markup. */
	public function test_send_posts_formatting_entities() {
		$provider = new TelegramProvider();
		$messages = $provider->split( self::summary( 1 ) );
		$provider->send( '@fair_channel', $messages[0] );

		$body = json_decode( $GLOBALS['_fair_test_remote_post_requests'][0]['args']['body'], true );
		$this->assertSame( "Calendar\n28 Sep – 4 Oct 2026\n\n• Mon, 18:00, A fairly long event title number 001", $body['text'] );
		$this->assertArrayNotHasKey( 'parse_mode', $body );
		$this->assertSame(
			array(
				array(
					'type'   => 'bold',
					'offset' => 0,
					'length' => 8,
				),
				array(
					'type'   => 'text_link',
					'offset' => 0,
					'length' => 8,
					'url'    => 'https://example.com/calendar/',
				),
				array(
					'type'   => 'text_link',
					'offset' => 44,
					'length' => 36,
					'url'    => 'https://example.com/events/001',
				),
			),
			$body['entities']
		);
	}

	/** Long summaries are split within Telegram's limit, in order, with valid links in every part. */
	public function test_split_respects_the_telegram_limit() {
		$parts = ( new TelegramProvider() )->split( self::summary( 200 ) );

		$this->assertGreaterThan( 1, count( $parts ) );
		$this->assertStringStartsWith( 'Calendar', $parts[0]['text'] );
		$next = 1;
		foreach ( $parts as $part ) {
			$this->assertLessThanOrEqual( TelegramProvider::MESSAGE_LIMIT, MessageSplitter::length( $part['text'] ) );
			foreach ( $part['entities'] as $entity ) {
				if ( 'text_link' !== $entity['type'] || 'https://example.com/calendar/' === $entity['url'] ) {
					continue;
				}
				$this->assertSame( sprintf( 'https://example.com/events/%03d', $next ), $entity['url'] );
				$this->assertSame(
					sprintf( 'A fairly long event title number %03d', $next ),
					mb_convert_encoding( substr( mb_convert_encoding( $part['text'], 'UTF-16LE', 'UTF-8' ), $entity['offset'] * 2, $entity['length'] * 2 ), 'UTF-8', 'UTF-16LE' )
				);
				++$next;
			}
		}
		$this->assertSame( 201, $next );
	}

	/** Plain-text messages are still accepted, without entities. */
	public function test_send_accepts_plain_text() {
		( new TelegramProvider() )->send( '@fair_channel', 'Just text' );

		$body = json_decode( $GLOBALS['_fair_test_remote_post_requests'][0]['args']['body'], true );
		$this->assertSame( 'Just text', $body['text'] );
		$this->assertArrayNotHasKey( 'entities', $body );
	}
}
