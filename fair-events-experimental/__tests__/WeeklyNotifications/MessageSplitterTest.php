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
}
