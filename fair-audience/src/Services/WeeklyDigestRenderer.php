<?php
/**
 * Weekly Digest Renderer
 *
 * Turns a WeeklyEventsProvider week ({ source, week, days }) into the inner
 * HTML body used for the digest preview, test-send, and cron send — one
 * renderer shared by all three so the mail participants receive always
 * matches what an admin previewed.
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Renders and sanitizes weekly digest content.
 */
class WeeklyDigestRenderer {

	/**
	 * Default digest configuration.
	 *
	 * @return array Default config.
	 */
	public static function default_config() {
		return array(
			'enabled'     => false,
			'source_slug' => '',
			'day_of_week' => 1,
			'time_of_day' => '08:00',
			'week_scope'  => 'current',
			'skip_empty'  => true,
			'subject'     => __( 'This week’s events: {week_start} – {week_end}', 'fair-audience' ),
			'intro'       => '',
		);
	}

	/**
	 * Sanitize the `fair_audience_weekly_digest` option value.
	 *
	 * @param mixed $value Raw value.
	 * @return array Sanitized config, merged over the defaults.
	 */
	public static function sanitize_config( $value ) {
		$defaults = self::default_config();

		if ( ! is_array( $value ) ) {
			return $defaults;
		}

		$day_of_week = isset( $value['day_of_week'] ) ? (int) $value['day_of_week'] : $defaults['day_of_week'];
		if ( $day_of_week < 1 || $day_of_week > 7 ) {
			$day_of_week = $defaults['day_of_week'];
		}

		$time_of_day = isset( $value['time_of_day'] ) ? sanitize_text_field( $value['time_of_day'] ) : $defaults['time_of_day'];
		if ( ! preg_match( '/^([01]\d|2[0-3]):[0-5]\d$/', $time_of_day ) ) {
			$time_of_day = $defaults['time_of_day'];
		}

		$week_scope = isset( $value['week_scope'] ) ? sanitize_text_field( $value['week_scope'] ) : $defaults['week_scope'];
		if ( ! in_array( $week_scope, array( 'current', 'next' ), true ) ) {
			$week_scope = $defaults['week_scope'];
		}

		return array(
			'enabled'     => ! empty( $value['enabled'] ),
			'source_slug' => isset( $value['source_slug'] ) ? sanitize_title( $value['source_slug'] ) : $defaults['source_slug'],
			'day_of_week' => $day_of_week,
			'time_of_day' => $time_of_day,
			'week_scope'  => $week_scope,
			'skip_empty'  => isset( $value['skip_empty'] ) ? ! empty( $value['skip_empty'] ) : $defaults['skip_empty'],
			'subject'     => isset( $value['subject'] ) ? sanitize_text_field( $value['subject'] ) : $defaults['subject'],
			'intro'       => isset( $value['intro'] ) ? wp_kses_post( $value['intro'] ) : $defaults['intro'],
		);
	}

	/**
	 * Whether a week has any events across its days.
	 *
	 * @param array $week Week data from WeeklyEventsProvider::get_week().
	 * @return bool True when every day is empty.
	 */
	public static function is_week_empty( array $week ) {
		foreach ( $week['days'] as $day ) {
			if ( ! empty( $day['events'] ) ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Render the digest subject, replacing week placeholders.
	 *
	 * @param string $subject_template Subject with {week_start}/{week_end} placeholders.
	 * @param array  $week             Week data from WeeklyEventsProvider::get_week().
	 * @return string Rendered subject.
	 */
	public static function render_subject( $subject_template, array $week ) {
		return str_replace(
			array( '{week_start}', '{week_end}' ),
			array( $week['week']['start'], $week['week']['end'] ),
			$subject_template
		);
	}

	/**
	 * Resolve the ISO year/week for 'current' or 'next' week scope.
	 *
	 * @param string $week_scope 'current' or 'next'.
	 * @return array{0:int,1:int} Year and ISO week number.
	 */
	public static function resolve_week_scope( $week_scope ) {
		$now = new \DateTime( 'now', wp_timezone() );

		if ( 'next' === $week_scope ) {
			$now->modify( '+7 days' );
		}

		return array( (int) $now->format( 'o' ), (int) $now->format( 'W' ) );
	}

	/**
	 * Render the digest's inner HTML body for a week.
	 *
	 * Returned HTML is the *inner* content — the caller (EmailService) wraps
	 * it in the shared branded email template via `wp_kses_post`.
	 *
	 * @param array  $week  Week data from WeeklyEventsProvider::get_week().
	 * @param string $intro Optional intro HTML (already sanitized).
	 * @return string Inner HTML content.
	 */
	public static function render( array $week, $intro = '' ) {
		$html = '';

		if ( ! empty( $intro ) ) {
			$html .= '<div style="margin: 0 0 20px 0;">' . wp_kses_post( $intro ) . '</div>';
		}

		foreach ( $week['days'] as $day ) {
			if ( empty( $day['events'] ) ) {
				continue;
			}

			$html .= '<h3 style="margin: 20px 0 10px 0; font-size: 16px;">'
				. esc_html( $day['weekday'] ) . ', ' . esc_html( $day['month_name'] ) . ' ' . esc_html( $day['day_num'] )
				. '</h3>';

			$html .= '<ul style="margin: 0 0 10px 0; padding-left: 20px;">';

			foreach ( $day['events'] as $event ) {
				$html .= '<li style="margin-bottom: 6px;">';

				if ( ! empty( $event['all_day'] ) ) {
					$html .= '<strong>' . esc_html__( 'All day', 'fair-audience' ) . '</strong> — ';
				} elseif ( ! empty( $event['start_time'] ) ) {
					$html .= '<strong>' . esc_html( $event['start_time'] ) . '</strong> — ';
				}

				$title = $event['title'];
				if ( ! empty( $event['url'] ) ) {
					$html .= '<a href="' . esc_url( $event['url'] ) . '">' . esc_html( $title ) . '</a>';
				} else {
					$html .= esc_html( $title );
				}

				$html .= '</li>';
			}

			$html .= '</ul>';
		}

		if ( '' === $html ) {
			$html = '<p>' . esc_html__( 'No events scheduled this week.', 'fair-audience' ) . '</p>';
		}

		return $html;
	}
}
