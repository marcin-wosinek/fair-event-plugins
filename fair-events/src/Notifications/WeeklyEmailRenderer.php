<?php
/**
 * Weekly events email content.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

use FairEvents\Services\EventsWeekSummary;

defined( 'WPINC' ) || die;

/**
 * Renders the content of every weekly events email: the email to one
 * configured address and Fair Audience's email to its subscribers.
 *
 * Only the content is rendered here. Each sender wraps it in its own email
 * layout, with the greeting, sign-off and links that fit its recipients.
 *
 * Fair Audience calls these methods when they exist. Never change their
 * signatures; add new methods instead.
 */
class WeeklyEmailRenderer {

	/**
	 * Non-profile Instagram path segments that aren't a handle.
	 *
	 * @var string[]
	 */
	private const INSTAGRAM_NON_PROFILE_SEGMENTS = array( 'p', 'reel', 'reels', 'explore', 'stories', 'tv' );

	/**
	 * Render the email for a week.
	 *
	 * @param array $events   Week from {@see \FairEvents\Services\WeeklyEventsProvider::for_notification()}
	 *                        or {@see \FairEvents\Services\WeeklyEventsProvider::get_week()}.
	 * @param array $settings Email settings: subject, intro, outro.
	 * @return array{subject: string, html: string, empty: bool}
	 */
	public static function compose( array $events, array $settings ) {
		return array(
			'subject' => self::subject( (string) ( $settings['subject'] ?? '' ), $events['week'] ),
			'html'    => self::body( $events, (string) ( $settings['intro'] ?? '' ), (string) ( $settings['outro'] ?? '' ) ),
			'empty'   => self::is_empty( $events ),
		);
	}

	/**
	 * The subject with its week placeholders filled in.
	 *
	 * @param string                            $template Subject with {week_start}/{week_end} placeholders.
	 * @param array{start: string, end: string} $week     Week boundaries.
	 * @return string
	 */
	public static function subject( $template, array $week ) {
		return sanitize_text_field(
			str_replace(
				array( '{week_start}', '{week_end}' ),
				array( $week['start'], $week['end'] ),
				(string) $template
			)
		);
	}

	/**
	 * Whether a week has no events on any of its days.
	 *
	 * @param array $events Week with `days`.
	 * @return bool
	 */
	public static function is_empty( array $events ) {
		foreach ( $events['days'] as $day ) {
			if ( ! empty( $day['events'] ) ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * The email content: optional text, the events day by day, optional text.
	 *
	 * @param array  $events Week with `week` boundaries and `days`.
	 * @param string $intro  Text above the events; basic HTML is kept.
	 * @param string $outro  Text below the events; basic HTML is kept.
	 * @return string HTML.
	 */
	public static function body( array $events, $intro = '', $outro = '' ) {
		$html = '';

		if ( '' !== trim( (string) $intro ) ) {
			$html .= '<div style="margin: 0 0 20px 0;">' . wp_kses_post( wpautop( $intro ) ) . '</div>';
		}

		foreach ( $events['days'] as $day ) {
			if ( empty( $day['events'] ) ) {
				continue;
			}

			$html .= '<h3 style="margin: 20px 0 10px 0; font-size: 16px;">' . esc_html(
				sprintf(
					/* translators: 1: weekday, e.g. "Wednesday", 2: month, e.g. "October", 3: day of the month */
					__( '%1$s, %2$s %3$s', 'fair-events' ),
					$day['weekday'],
					$day['month_name'],
					$day['day_num']
				)
			) . '</h3>';
			$html .= '<ul style="margin: 0 0 10px 0; padding-left: 20px;">';
			foreach ( $day['events'] as $event ) {
				$html .= '<li style="margin-bottom: 6px;">' . self::event( $event ) . '</li>';
			}
			$html .= '</ul>';
		}

		if ( self::is_empty( $events ) ) {
			$html .= '<p>' . esc_html(
				sprintf(
					/* translators: %s: date range of a week, e.g. "12–18 Oct 2026" */
					__( 'No events are scheduled for %s.', 'fair-events' ),
					EventsWeekSummary::range_title( $events['week']['start'], $events['week']['end'] )
				)
			) . '</p>';
		}

		if ( '' !== trim( (string) $outro ) ) {
			$html .= '<div style="margin: 20px 0 0 0;">' . wp_kses_post( wpautop( $outro ) ) . '</div>';
		}

		return $html;
	}

	/**
	 * One event: its time, then its title, linked when it has a web page.
	 *
	 * @param array $event Day event from the week's `days`.
	 * @return string HTML.
	 */
	private static function event( array $event ) {
		$html = '';
		if ( ! empty( $event['all_day'] ) ) {
			$html .= '<strong>' . esc_html__( 'All day', 'fair-events' ) . '</strong> — ';
		} elseif ( ! empty( $event['start_time'] ) ) {
			$html .= '<strong>' . esc_html( $event['start_time'] ) . '</strong> — ';
		}

		$title = trim( html_entity_decode( (string) ( $event['title'] ?? '' ), ENT_QUOTES | ENT_HTML5, 'UTF-8' ) );
		if ( '' === $title ) {
			$title = __( '(untitled event)', 'fair-events' );
		}

		$url = (string) ( $event['url'] ?? '' );
		// Only web links: an imported event could carry any scheme.
		if ( ! preg_match( '#^https?://#i', $url ) ) {
			return $html . esc_html( $title );
		}

		$html       .= '<a href="' . esc_url( $url ) . '">' . esc_html( $title ) . '</a>';
		$attribution = self::source_attribution( $url );
		if ( '' !== $attribution ) {
			$html .= ' <span style="color: #666666;">' . esc_html( $attribution ) . '</span>';
		}

		return $html;
	}

	/**
	 * The "(by …)" note after a link to another site.
	 *
	 * Links to this site get none. Instagram links name the profile when the
	 * path starts with one; other links name the host without "www.".
	 *
	 * @param string $url Event URL.
	 * @return string Attribution, e.g. "(by example.com)", or ''.
	 */
	public static function source_attribution( $url ) {
		$host = wp_parse_url( $url, PHP_URL_HOST );
		if ( empty( $host ) ) {
			return '';
		}

		$host      = strtolower( $host );
		$site_host = strtolower( (string) wp_parse_url( get_site_url(), PHP_URL_HOST ) );
		if ( $host === $site_host ) {
			return '';
		}

		if ( in_array( $host, array( 'instagram.com', 'www.instagram.com', 'm.instagram.com' ), true ) ) {
			$segment = trim( (string) wp_parse_url( $url, PHP_URL_PATH ), '/' );
			$segment = false !== strpos( $segment, '/' ) ? strstr( $segment, '/', true ) : $segment;

			if ( '' === $segment || in_array( $segment, self::INSTAGRAM_NON_PROFILE_SEGMENTS, true ) ) {
				/* translators: %s: source host, e.g. "instagram.com". */
				return sprintf( __( '(by %s)', 'fair-events' ), 'instagram.com' );
			}

			/* translators: %s: Instagram handle, e.g. "@example". */
			return sprintf( __( '(by @%s)', 'fair-events' ), $segment );
		}

		/* translators: %s: source domain, e.g. "example.com". */
		return sprintf( __( '(by %s)', 'fair-events' ), preg_replace( '/^www\./', '', $host ) );
	}
}
