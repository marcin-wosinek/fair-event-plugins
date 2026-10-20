<?php
/**
 * Server-side rendering for the Calendar Button block
 *
 * @package FairCalendarButton
 */

namespace FairCalendarButton\Render;

use FairCalendarButton\Integration\FairEventsData;

defined( 'WPINC' ) || die;

/**
 * Renders the block wrapper with the calendar entry's data attributes.
 */
class CalendarButtonRenderer {

	/**
	 * Render the block.
	 *
	 * A button synchronized with its event reads the event's current dates,
	 * all-day setting and location on every render, so changes to the event
	 * show without saving the post again; the recurrence stays manual. When
	 * the event data is unavailable or not exportable, the button gets no
	 * event data and `data-calendar-available="false"`, and clicking it does
	 * nothing. Other buttons use their saved attributes.
	 *
	 * @param array          $attributes Block attributes.
	 * @param string         $content    Inner blocks markup.
	 * @param \WP_Block|null $block      Block instance, for its post context.
	 * @return string Block markup.
	 */
	public static function render( $attributes, $content, $block = null ) {
		$post_id = isset( $block->context['postId'] ) ? (int) $block->context['postId'] : (int) get_the_ID();

		$values = array(
			'start'    => $attributes['start'] ?? '',
			'end'      => $attributes['end'] ?? '',
			'allDay'   => ! empty( $attributes['allDay'] ),
			'location' => $attributes['location'] ?? '',
		);

		$recurring = ! empty( $attributes['recurring'] );
		$rrule     = $attributes['rRule'] ?? '';
		$available = true;

		if ( self::is_synchronized( $attributes, $post_id ) ) {
			$synced = FairEventsData::calendar_values( $post_id );

			if ( $synced ) {
				$values = $synced;
			} else {
				$values    = array(
					'start'    => '',
					'end'      => '',
					'allDay'   => false,
					'location' => '',
				);
				$recurring = false;
				$rrule     = '';
				$available = false;
			}
		}

		$classes = 'calendar-button-container';

		// is_plugin_active() lives in wp-admin/includes/plugin.php, which isn't
		// autoloaded on front-end requests where this render callback also runs.
		if ( ! function_exists( 'is_plugin_active' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		if ( is_plugin_active( 'plausible-analytics/plausible-analytics.php' ) ) {
			$classes .= ' plausible-event-name=Fair+calendar+button';
		}

		$data = array(
			'class'            => esc_attr( $classes ),
			'data-start'       => esc_attr( $values['start'] ),
			'data-end'         => esc_attr( $values['end'] ),
			'data-all-day'     => $values['allDay'] ? 'true' : 'false',
			'data-description' => esc_attr( $attributes['description'] ?? '' ),
			'data-location'    => esc_attr( $values['location'] ),
			'data-title'       => esc_attr( get_the_title( $post_id ) ),
			'data-recurring'   => $recurring ? 'true' : 'false',
			'data-rrule'       => esc_attr( $rrule ),
			'data-url'         => esc_attr( (string) get_permalink( $post_id ) ),
		);

		if ( ! $available ) {
			$data['data-calendar-available'] = 'false';
		}

		return sprintf(
			'<div %s>%s</div>',
			wp_kses_data( get_block_wrapper_attributes( $data ) ),
			wp_kses_post( $content )
		);
	}

	/**
	 * Whether the button takes its values from the event: synchronization
	 * is on and the button belongs to a Fair Events event post.
	 *
	 * @param array $attributes Block attributes.
	 * @param int   $post_id    Post the block renders for.
	 * @return bool
	 */
	private static function is_synchronized( $attributes, $post_id ) {
		return ! empty( $attributes['syncWithEvent'] )
			&& $post_id
			&& 'fair_event' === get_post_type( $post_id );
	}
}
