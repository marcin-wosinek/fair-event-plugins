<?php
/**
 * TelegramFormatter unit tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\WeeklyNotifications;

use FairEventsExperimental\WeeklyNotifications\MessageSplitter;
use FairEventsExperimental\WeeklyNotifications\TelegramFormatter;
use PHPUnit\Framework\TestCase;

/**
 * Tests the Telegram layout of the weekly summary.
 */
class TelegramFormatterTest extends TestCase {

	/**
	 * Format a summary as one message.
	 *
	 * @param array $events Events.
	 * @return array{text: string, entities: array[]}
	 */
	private static function message( array $events ) {
		$messages = MessageSplitter::split_lines(
			TelegramFormatter::lines(
				array(
					'title'  => 'Calendar',
					'url'    => 'https://example.com/calendar/',
					'range'  => '28 Sep – 4 Oct 2026',
					'events' => $events,
				)
			),
			4096
		);
		return $messages[0];
	}

	/**
	 * Text an entity covers.
	 *
	 * @param string $text   Message text.
	 * @param array  $entity Entity.
	 * @return string
	 */
	private static function covered( $text, array $entity ) {
		$utf16 = mb_convert_encoding( $text, 'UTF-16LE', 'UTF-8' );
		return mb_convert_encoding( substr( $utf16, $entity['offset'] * 2, $entity['length'] * 2 ), 'UTF-8', 'UTF-16LE' );
	}

	/**
	 * Link entities of a message as covered text => URL.
	 *
	 * @param array $message Message.
	 * @return array<string, string>
	 */
	private static function links( array $message ) {
		$links = array();
		foreach ( $message['entities'] as $entity ) {
			if ( 'text_link' === $entity['type'] ) {
				$links[ self::covered( $message['text'], $entity ) ] = $entity['url'];
			}
		}
		return $links;
	}

	/** Heading, range and bullet items, with linked titles and no raw URLs or asterisks. */
	public function test_layout() {
		$message = self::message(
			array(
				array(
					'when'  => 'Mon, 18:00',
					'title' => 'Concert',
					'url'   => 'https://example.com/concert/',
				),
				array(
					'when'  => 'Fri–Sun',
					'title' => 'Festival',
					'url'   => '',
				),
			)
		);

		$this->assertSame( "Calendar\n28 Sep – 4 Oct 2026\n\n• Mon, 18:00, Concert\n• Fri–Sun, Festival", $message['text'] );
		$this->assertSame(
			array(
				'Calendar' => 'https://example.com/calendar/',
				'Concert'  => 'https://example.com/concert/',
			),
			self::links( $message )
		);
		$this->assertStringNotContainsString( 'https://', $message['text'] );
		$this->assertStringNotContainsString( '*', $message['text'] );
	}

	/** Titles and URLs with formatting characters are sent verbatim, with offsets in UTF-16 units. */
	public function test_formatting_characters_and_emoji_are_verbatim() {
		$title   = '🎉 *Bold* _x_ [a](b) <b>&amp; `c`';
		$url     = 'https://example.com/e/?a=1&b=*_[]()~`>#+-=|{}.!';
		$message = self::message(
			array(
				array(
					'when'  => '🎸 Mon',
					'title' => $title,
					'url'   => $url,
				),
			)
		);

		$this->assertStringContainsString( '• 🎸 Mon, ' . $title, $message['text'] );
		$this->assertSame( $url, self::links( $message )[ $title ] );
	}

	/** Missing titles get a placeholder; unusable URLs leave the title unlinked. */
	public function test_missing_titles_and_unusable_links() {
		$message = self::message(
			array(
				array(
					'when'  => 'Mon',
					'title' => '',
					'url'   => 'https://example.com/untitled/',
				),
				array(
					'when'  => 'Tue',
					'title' => 'Script',
					'url'   => 'javascript:alert(1)',
				),
				array(
					'when'  => 'Wed',
					'title' => 'Relative',
					'url'   => '/events/relative/',
				),
				array(
					'when'  => 'Thu',
					'title' => 'Spaced',
					'url'   => "https://example.com/a b\n",
				),
			)
		);

		$this->assertStringContainsString( '• Mon, (no title)', $message['text'] );
		$this->assertSame(
			array(
				'Calendar'   => 'https://example.com/calendar/',
				'(no title)' => 'https://example.com/untitled/',
			),
			self::links( $message )
		);
	}

	/** Only public http(s) URLs with a host are links. */
	public function test_link_validation() {
		$this->assertSame( 'http://localhost:8080/?p=1', TelegramFormatter::link( ' http://localhost:8080/?p=1 ' ) );
		$this->assertSame( '', TelegramFormatter::link( 'ftp://example.com/' ) );
		$this->assertSame( '', TelegramFormatter::link( 'https:///path' ) );
		$this->assertSame( '', TelegramFormatter::link( '' ) );
	}
}
