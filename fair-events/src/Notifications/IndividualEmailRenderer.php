<?php
/**
 * Individual email notification renderer.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

use FairEvents\Services\EventsWeekSummary;
use FairEvents\Services\EventsWeekSummaryFormatter;

defined( 'WPINC' ) || die;

/**
 * Renders the weekly email sent to the one configured address.
 *
 * The preview, the test and the scheduled send all use this renderer, so the
 * email that arrives is the one that was previewed.
 */
class IndividualEmailRenderer {

	/**
	 * Render the email for a week.
	 *
	 * @param array                             $settings    Individual email settings.
	 * @param array{start: string, end: string} $week        Week boundaries.
	 * @param array[]                           $occurrences Occurrence DTOs in display order.
	 * @return array{subject: string, html: string, empty: bool}
	 */
	public static function compose( array $settings, array $week, array $occurrences ) {
		return array(
			'subject' => self::subject( (string) ( $settings['subject'] ?? '' ), $week ),
			'html'    => self::body( $week, $occurrences, (string) ( $settings['intro'] ?? '' ), (string) ( $settings['outro'] ?? '' ) ),
			'empty'   => ! $occurrences,
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
				$template
			)
		);
	}

	/**
	 * The email body: optional text, the week's events, optional text.
	 *
	 * @param array{start: string, end: string} $week        Week boundaries.
	 * @param array[]                           $occurrences Occurrence DTOs in display order.
	 * @param string                            $intro       Text above the events.
	 * @param string                            $outro       Text below the events.
	 * @return string HTML.
	 */
	private static function body( array $week, array $occurrences, $intro, $outro ) {
		$range = EventsWeekSummary::range_title( $week['start'], $week['end'] );
		$html  = '';

		if ( '' !== trim( $intro ) ) {
			$html .= '<div style="margin: 0 0 20px 0;">' . wpautop( wp_kses_post( $intro ) ) . '</div>';
		}

		if ( $occurrences ) {
			$html .= '<h3 style="margin: 20px 0 10px 0; font-size: 16px;">' . esc_html( $range ) . '</h3>';
			$html .= '<ul style="margin: 0 0 10px 0; padding-left: 20px;">';
			foreach ( $occurrences as $occurrence ) {
				$html .= '<li style="margin-bottom: 6px;">' . self::event( $occurrence, $week ) . '</li>';
			}
			$html .= '</ul>';
		} else {
			$html .= '<p>' . esc_html(
				sprintf(
					/* translators: %s: date range of a week, e.g. "12–18 Oct 2026" */
					__( 'No events are scheduled for %s.', 'fair-events' ),
					$range
				)
			) . '</p>';
		}

		if ( '' !== trim( $outro ) ) {
			$html .= '<div style="margin: 20px 0 0 0;">' . wpautop( wp_kses_post( $outro ) ) . '</div>';
		}

		return $html;
	}

	/**
	 * One event: when it happens, then its title, linked when it has a page.
	 *
	 * @param array                             $occurrence Occurrence DTO.
	 * @param array{start: string, end: string} $week       Week boundaries.
	 * @return string HTML.
	 */
	private static function event( array $occurrence, array $week ) {
		$when  = EventsWeekSummaryFormatter::when( $occurrence, $week['start'], $week['end'] );
		$title = trim( html_entity_decode( (string) ( $occurrence['title'] ?? '' ), ENT_QUOTES | ENT_HTML5, 'UTF-8' ) );
		if ( '' === $title ) {
			$title = __( '(untitled event)', 'fair-events' );
		}
		$url = (string) ( $occurrence['url'] ?? '' );

		$html = '<strong>' . esc_html( $when ) . '</strong> — ';
		// Only web links: an imported event could carry any scheme.
		if ( preg_match( '#^https?://#i', $url ) ) {
			return $html . '<a href="' . esc_url( $url ) . '">' . esc_html( $title ) . '</a>';
		}

		return $html . esc_html( $title );
	}
}
