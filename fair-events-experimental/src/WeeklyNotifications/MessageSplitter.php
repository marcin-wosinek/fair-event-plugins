<?php
/**
 * Splits a summary into provider-sized messages.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WeeklyNotifications;

defined( 'WPINC' ) || die;

/**
 * Packs summary lines into ordered messages that each fit a length limit.
 *
 * Messages break between lines, so the heading appears only in the first
 * message and each event line stays whole. A single line longer than the
 * limit is broken at whitespace where possible, otherwise between characters;
 * every character of the input appears in the output, in order.
 *
 * Lengths are UTF-16 code units, which is how Telegram measures its limit.
 */
class MessageSplitter {

	/**
	 * Split text into messages of at most $limit UTF-16 code units.
	 *
	 * @param string $text  Newline-separated text.
	 * @param int    $limit Maximum message length.
	 * @return string[] Messages in order; empty for empty text.
	 */
	public static function split( $text, $limit ) {
		if ( '' === $text ) {
			return array();
		}

		$messages = array();
		$current  = null;

		foreach ( explode( "\n", $text ) as $line ) {
			foreach ( self::split_line( $line, $limit ) as $segment ) {
				if ( null === $current ) {
					$current = $segment;
				} elseif ( self::length( $current ) + 1 + self::length( $segment ) <= $limit ) {
					$current .= "\n" . $segment;
				} else {
					$messages[] = $current;
					$current    = $segment;
				}
			}
		}

		if ( null !== $current ) {
			$messages[] = $current;
		}

		return $messages;
	}

	/**
	 * Length in UTF-16 code units.
	 *
	 * @param string $text UTF-8 text.
	 * @return int
	 */
	public static function length( $text ) {
		return (int) ( strlen( mb_convert_encoding( $text, 'UTF-16LE', 'UTF-8' ) ) / 2 );
	}

	/**
	 * Break one line into segments of at most $limit code units.
	 *
	 * @param string $line  One line of text.
	 * @param int    $limit Maximum segment length.
	 * @return string[]
	 */
	private static function split_line( $line, $limit ) {
		if ( self::length( $line ) <= $limit ) {
			return array( $line );
		}

		$segments = array();
		$current  = '';
		$length   = 0;
		$chars    = preg_split( '//u', $line, -1, PREG_SPLIT_NO_EMPTY );

		foreach ( $chars as $char ) {
			$char_length = self::length( $char );
			while ( '' !== $current && $length + $char_length > $limit ) {
				list( $segment, $current ) = self::break_at_whitespace( $current );
				$segments[]                = $segment;
				$length                    = self::length( $current );
			}
			$current .= $char;
			$length  += $char_length;
		}

		if ( '' !== $current ) {
			$segments[] = $current;
		}

		return $segments;
	}

	/**
	 * Split a full segment after its last whitespace, keeping every character.
	 *
	 * @param string $segment Segment that reached the limit.
	 * @return array{0: string, 1: string} The finished segment and the carried-over remainder.
	 */
	private static function break_at_whitespace( $segment ) {
		if ( preg_match( '/^(.*\s)(\S+)$/su', $segment, $matches ) && '' !== trim( $matches[1] ) ) {
			return array( $matches[1], $matches[2] );
		}

		return array( $segment, '' );
	}
}
