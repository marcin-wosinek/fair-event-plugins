<?php
/**
 * Telegram presentation of the weekly summary.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WeeklyNotifications;

defined( 'WPINC' ) || die;

/**
 * Lays the summary out as formatted lines for {@see MessageSplitter::split_lines()}:
 *
 *     Calendar page title        (bold, linked to the page)
 *     28 Sep – 4 Oct 2026
 *
 *     • Mon, 18:00, Event title  (title linked to the event)
 *
 * Links and bold are sent as Telegram message entities on plain text, so
 * titles and URLs never need markup escaping.
 */
class TelegramFormatter {
	public const BULLET = '•';

	/**
	 * Formatted lines for a summary.
	 *
	 * @param array $summary Summary from {@see SummaryBuilder::build()}.
	 * @return array[] Lines of runs.
	 */
	public static function lines( array $summary ) {
		$lines = array(
			array(
				array(
					'text' => self::title( $summary['title'] ?? '' ),
					'url'  => self::link( $summary['url'] ?? '' ),
					'bold' => true,
				),
			),
			array( array( 'text' => (string) ( $summary['range'] ?? '' ) ) ),
			array(),
		);

		foreach ( (array) ( $summary['events'] ?? array() ) as $event ) {
			$lines[] = array(
				array( 'text' => self::BULLET . ' ' . $event['when'] . ', ' ),
				array(
					'text' => self::title( $event['title'] ?? '' ),
					'url'  => self::link( $event['url'] ?? '' ),
				),
			);
		}

		return $lines;
	}

	/**
	 * A title, or a placeholder when it is empty.
	 *
	 * @param string $title Title.
	 * @return string
	 */
	private static function title( $title ) {
		$title = trim( (string) $title );
		return '' !== $title ? $title : __( '(no title)', 'fair-events-experimental' );
	}

	/**
	 * The URL if it is a usable public http(s) link, otherwise ''.
	 *
	 * @param string $url URL.
	 * @return string
	 */
	public static function link( $url ) {
		$url = trim( (string) $url );
		if ( '' === $url || preg_match( '/[\s\x00-\x1f\x7f]/', $url ) ) {
			return '';
		}

		$parts = wp_parse_url( $url );
		if ( ! is_array( $parts ) || empty( $parts['host'] ) || ! in_array( strtolower( $parts['scheme'] ?? '' ), array( 'http', 'https' ), true ) ) {
			return '';
		}

		return $url;
	}
}
