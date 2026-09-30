<?php
/**
 * MessageSplitter unit tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\WeeklyNotifications;

use FairEventsExperimental\WeeklyNotifications\MessageSplitter;
use PHPUnit\Framework\TestCase;

/**
 * Tests splitting long summaries into ordered messages.
 */
class MessageSplitterTest extends TestCase {

	/**
	 * Assert every message fits the limit.
	 *
	 * @param string[] $messages Messages.
	 * @param int      $limit    Limit.
	 * @return void
	 */
	private function assert_within_limit( array $messages, $limit ) {
		foreach ( $messages as $message ) {
			$this->assertLessThanOrEqual( $limit, MessageSplitter::length( $message ) );
		}
	}

	/** A short summary is one message. */
	public function test_short_text_is_one_message() {
		$this->assertSame( array( "Heading:\n* Mon, Event" ), MessageSplitter::split( "Heading:\n* Mon, Event", 4096 ) );
	}

	/** Empty text produces no messages. */
	public function test_empty_text_produces_no_messages() {
		$this->assertSame( array(), MessageSplitter::split( '', 4096 ) );
	}

	/** Messages break between event lines, with the heading only in the first. */
	public function test_splits_at_line_boundaries_with_heading_once() {
		$lines = array( 'Calendar (https://example.com), 14–20 Sep 2026:' );
		for ( $i = 1; $i <= 60; $i++ ) {
			$lines[] = sprintf( '* Mon, 18:00, Event number %02d: https://example.com/events/%02d', $i, $i );
		}
		$text     = implode( "\n", $lines );
		$messages = MessageSplitter::split( $text, 500 );

		$this->assertGreaterThan( 1, count( $messages ) );
		$this->assert_within_limit( $messages, 500 );
		$this->assertSame( $text, implode( "\n", $messages ) );
		$this->assertStringStartsWith( 'Calendar (', $messages[0] );
		foreach ( array_slice( $messages, 1 ) as $message ) {
			$this->assertStringNotContainsString( 'Calendar (', $message );
			$this->assertStringStartsWith( '* Mon', $message );
		}
	}

	/** A line longer than the limit is broken without losing any text. */
	public function test_oversized_line_keeps_all_text() {
		$line     = '* Mon, ' . str_repeat( 'Very long title ', 40 ) . ': https://example.com/event';
		$text     = "Heading:\n" . $line . "\n* Tue, Short";
		$messages = MessageSplitter::split( $text, 100 );

		$this->assert_within_limit( $messages, 100 );
		$this->assertSame( str_replace( "\n", '', $text ), str_replace( "\n", '', implode( '', $messages ) ) );
	}

	/** A line with no whitespace is broken between characters. */
	public function test_unbroken_line_is_split_between_characters() {
		$line     = str_repeat( 'x', 250 );
		$messages = MessageSplitter::split( $line, 100 );

		$this->assertSame( array( str_repeat( 'x', 100 ), str_repeat( 'x', 100 ), str_repeat( 'x', 50 ) ), $messages );
	}

	/** Lengths count UTF-16 code units, and surrogate pairs are never split. */
	public function test_length_counts_utf16_units_and_keeps_emoji_whole() {
		$this->assertSame( 2, MessageSplitter::length( '🎉' ) );
		$this->assertSame( 5, MessageSplitter::length( 'Café!' ) );

		$messages = MessageSplitter::split( str_repeat( '🎉', 6 ), 5 );

		$this->assertSame( array( '🎉🎉', '🎉🎉', '🎉🎉' ), $messages );
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

	/** Entity offsets count UTF-16 units and are relative to each message. */
	public function test_entities_are_relative_to_each_message() {
		$lines = array(
			array( array( 'text' => 'Heading 🎉' ) ),
			array(
				array( 'text' => '• 🎉 Mon, ' ),
				array(
					'text' => 'First 🎸',
					'url'  => 'https://example.com/1',
				),
			),
			array(
				array( 'text' => '• Tue, ' ),
				array(
					'text' => 'Second',
					'url'  => 'https://example.com/2',
				),
			),
		);

		$messages = MessageSplitter::split_lines( $lines, 30 );

		$this->assertSame( array( "Heading 🎉\n• 🎉 Mon, First 🎸", '• Tue, Second' ), array_column( $messages, 'text' ) );
		$this->assertSame( 'First 🎸', self::covered( $messages[0]['text'], $messages[0]['entities'][0] ) );
		$this->assertSame( 21, $messages[0]['entities'][0]['offset'] );
		$this->assertSame( 'Second', self::covered( $messages[1]['text'], $messages[1]['entities'][0] ) );
		$this->assertSame( 7, $messages[1]['entities'][0]['offset'] );
	}

	/** A line that exactly fills the limit is packed; one unit more starts a new message. */
	public function test_boundary_sizes() {
		$line = array( array( array( 'text' => str_repeat( 'a', 10 ) ) ), array( array( 'text' => str_repeat( 'b', 9 ) ) ) );
		$this->assertCount( 1, MessageSplitter::split_lines( $line, 20 ) );
		$this->assertCount( 2, MessageSplitter::split_lines( $line, 19 ) );
	}

	/** An oversized linked item is split, and each piece keeps the link. */
	public function test_oversized_linked_item_keeps_the_link_on_every_piece() {
		$title    = trim( str_repeat( 'Very long title ', 20 ) );
		$lines    = array(
			array( array( 'text' => 'Heading' ) ),
			array(
				array( 'text' => '• Mon, ' ),
				array(
					'text' => $title,
					'url'  => 'https://example.com/long',
				),
			),
			array( array( 'text' => '• Tue, Short' ) ),
		);
		$messages = MessageSplitter::split_lines( $lines, 100 );

		$this->assertGreaterThan( 2, count( $messages ) );
		$covered = '';
		foreach ( $messages as $message ) {
			$this->assertLessThanOrEqual( 100, MessageSplitter::length( $message['text'] ) );
			foreach ( $message['entities'] as $entity ) {
				$this->assertSame( 'https://example.com/long', $entity['url'] );
				$this->assertGreaterThan( 0, $entity['length'] );
				$this->assertLessThanOrEqual( MessageSplitter::length( $message['text'] ), $entity['offset'] + $entity['length'] );
				$covered .= self::covered( $message['text'], $entity );
			}
		}
		$this->assertSame( $title, $covered );
		$this->assertSame( '• Tue, Short', substr( end( $messages )['text'], -strlen( '• Tue, Short' ) ) );
	}

	/** A message never starts with an empty line. */
	public function test_message_never_starts_with_an_empty_line() {
		$lines    = array(
			array( array( 'text' => str_repeat( 'a', 10 ) ) ),
			array(),
			array( array( 'text' => str_repeat( 'b', 10 ) ) ),
		);
		$messages = MessageSplitter::split_lines( $lines, 10 );

		$this->assertSame( array( str_repeat( 'a', 10 ), str_repeat( 'b', 10 ) ), array_column( $messages, 'text' ) );
	}
}
