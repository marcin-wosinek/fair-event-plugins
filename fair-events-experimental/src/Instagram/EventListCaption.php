<?php
/**
 * Caption of a scheduled Instagram event-list post
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Instagram;

use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Lays a weekly summary out as an Instagram caption:
 *
 *     Calendar page title
 *     28 Sep – 4 Oct 2026
 *
 *     • Mon, 18:00, Event title
 *
 *     https://example.com/calendar/
 *
 * The summary's titles are plain text already (decoded once by Fair Events'
 * SummaryBuilder), so they are used as they are. A caption Instagram would
 * refuse is reported, never shortened: every event stays in it.
 */
class EventListCaption {

	/**
	 * Instagram's limits for a caption.
	 */
	const MAX_LENGTH   = 2200;
	const MAX_HASHTAGS = 30;
	const MAX_MENTIONS = 20;

	const BULLET = '•';

	/**
	 * The caption for a summary.
	 *
	 * @param array $summary Summary with title, range, url and events (when, title).
	 * @return string|WP_Error
	 */
	public static function format( array $summary ) {
		$lines = array();
		$title = trim( (string) ( $summary['title'] ?? '' ) );
		if ( '' !== $title ) {
			$lines[] = $title;
		}
		$lines[] = trim( (string) ( $summary['range'] ?? '' ) );
		$lines[] = '';

		foreach ( (array) ( $summary['events'] ?? array() ) as $event ) {
			$name    = trim( (string) ( $event['title'] ?? '' ) );
			$lines[] = self::BULLET . ' ' . trim( (string) ( $event['when'] ?? '' ) ) . ', '
				. ( '' !== $name ? $name : __( '(no title)', 'fair-events-experimental' ) );
		}

		$url = self::link( (string) ( $summary['url'] ?? '' ) );
		if ( '' !== $url ) {
			$lines[] = '';
			$lines[] = $url;
		}

		$caption = implode( "\n", $lines );
		$length  = mb_strlen( $caption );
		if ( $length > self::MAX_LENGTH ) {
			return new WP_Error(
				'instagram_caption_too_long',
				sprintf(
					/* translators: 1: caption length in characters, 2: Instagram's limit */
					__( 'The list of events makes a caption of %1$d characters, but Instagram accepts at most %2$d. Nothing was published. Choose an event feed with fewer events for this notification.', 'fair-events-experimental' ),
					$length,
					self::MAX_LENGTH
				)
			);
		}

		if ( preg_match_all( '/(?:^|\s)#[^\s#]+/u', $caption ) > self::MAX_HASHTAGS ) {
			return new WP_Error(
				'instagram_caption_hashtags',
				sprintf(
					/* translators: %d: Instagram's hashtag limit */
					__( 'The event names contain more than %d hashtags, which Instagram refuses. Nothing was published. Remove hashtags from the event names.', 'fair-events-experimental' ),
					self::MAX_HASHTAGS
				)
			);
		}

		if ( preg_match_all( '/(?:^|\s)@[A-Za-z0-9._]+/u', $caption ) > self::MAX_MENTIONS ) {
			return new WP_Error(
				'instagram_caption_mentions',
				sprintf(
					/* translators: %d: Instagram's mention limit */
					__( 'The event names mention more than %d accounts with @, which Instagram refuses. Nothing was published. Remove the mentions from the event names.', 'fair-events-experimental' ),
					self::MAX_MENTIONS
				)
			);
		}

		return $caption;
	}

	/**
	 * The URL if it is a public http(s) link, otherwise ''.
	 *
	 * @param string $url URL.
	 * @return string
	 */
	private static function link( $url ) {
		$url = trim( $url );
		if ( '' === $url || preg_match( '/[\s\x00-\x1f\x7f]/', $url ) ) {
			return '';
		}
		$scheme = strtolower( (string) wp_parse_url( $url, PHP_URL_SCHEME ) );
		$host   = (string) wp_parse_url( $url, PHP_URL_HOST );

		return in_array( $scheme, array( 'http', 'https' ), true ) && '' !== $host ? $url : '';
	}
}
