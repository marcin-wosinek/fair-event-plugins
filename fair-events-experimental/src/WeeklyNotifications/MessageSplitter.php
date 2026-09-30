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
 * Lines can carry formatting (bold text and links). Each message gets its own
 * formatting entities, with offsets relative to that message, so a link on a
 * line broken across messages is recreated on every piece.
 *
 * Lengths and offsets are UTF-16 code units, which is how Telegram measures
 * its limit and its entity offsets.
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

		$lines = array_map( static fn( $line ) => array( array( 'text' => $line ) ), explode( "\n", $text ) );

		return array_column( self::split_lines( $lines, $limit ), 'text' );
	}

	/**
	 * Split formatted lines into messages of at most $limit UTF-16 code units.
	 *
	 * A line is a list of runs: `text`, plus an optional `url` (the run links
	 * there) and `bold`. A message never starts with an empty line.
	 *
	 * @param array[] $lines Lines of runs.
	 * @param int     $limit Maximum message length.
	 * @return array{text: string, entities: array[]}[] Messages in order. Entities
	 *     have `type` ('bold' or 'text_link'), `offset`, `length` and, for links, `url`.
	 */
	public static function split_lines( array $lines, $limit ) {
		$messages = array();
		$current  = null;

		foreach ( $lines as $runs ) {
			list( $line, $spans ) = self::flatten( $runs );
			$offset               = 0;

			foreach ( self::split_line( $line, $limit ) as $segment ) {
				$length   = self::length( $segment );
				$entities = self::clip( $spans, $offset, $length );
				$offset  += $length;

				if ( null !== $current && $current['length'] + 1 + $length <= $limit ) {
					foreach ( $entities as $entity ) {
						$entity['offset']     += $current['length'] + 1;
						$current['entities'][] = $entity;
					}
					$current['text']   .= "\n" . $segment;
					$current['length'] += 1 + $length;
					continue;
				}

				if ( null !== $current ) {
					$messages[] = $current;
					$current    = null;
				}
				if ( '' !== $segment ) {
					$current = array(
						'text'     => $segment,
						'entities' => $entities,
						'length'   => $length,
					);
				}
			}
		}

		if ( null !== $current ) {
			$messages[] = $current;
		}

		return array_map(
			static fn( $message ) => array(
				'text'     => $message['text'],
				'entities' => $message['entities'],
			),
			$messages
		);
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
	 * Join a line's runs and locate their formatting.
	 *
	 * @param array[] $runs Runs with `text` and optional `url` and `bold`.
	 * @return array{0: string, 1: array[]} The line text and its entities.
	 */
	private static function flatten( array $runs ) {
		$text  = '';
		$spans = array();
		$at    = 0;

		foreach ( $runs as $run ) {
			$run_text = (string) ( $run['text'] ?? '' );
			$length   = self::length( $run_text );
			if ( $length > 0 && ! empty( $run['bold'] ) ) {
				$spans[] = array(
					'type'   => 'bold',
					'offset' => $at,
					'length' => $length,
				);
			}
			if ( $length > 0 && ! empty( $run['url'] ) ) {
				$spans[] = array(
					'type'   => 'text_link',
					'offset' => $at,
					'length' => $length,
					'url'    => (string) $run['url'],
				);
			}
			$text .= $run_text;
			$at   += $length;
		}

		return array( $text, $spans );
	}

	/**
	 * The parts of a line's entities that fall within one of its segments.
	 *
	 * @param array[] $spans  Entities with offsets relative to the line.
	 * @param int     $start  Segment start within the line.
	 * @param int     $length Segment length.
	 * @return array[] Entities with offsets relative to the segment.
	 */
	private static function clip( array $spans, $start, $length ) {
		$entities = array();

		foreach ( $spans as $span ) {
			$from = max( $span['offset'], $start );
			$to   = min( $span['offset'] + $span['length'], $start + $length );
			if ( $to > $from ) {
				$span['offset'] = $from - $start;
				$span['length'] = $to - $from;
				$entities[]     = $span;
			}
		}

		return $entities;
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
