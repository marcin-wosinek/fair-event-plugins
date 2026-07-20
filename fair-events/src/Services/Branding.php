<?php
/**
 * "Powered by Fair Event Plugins" branding markup.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

/**
 * Centralizes the opt-in attribution line for the fair-events public blocks
 * (events calendar, events week, event signup).
 *
 * The fair-audience plugin ships an equivalent FairAudience\Services\Branding
 * for its own surfaces. Each plugin owns a copy so the attribution keeps
 * rendering even when the other plugin is not installed — fair-events blocks
 * previously depended on the fair-audience class existing, which silently
 * dropped the line on sites running fair-events on its own (issue #1204).
 *
 * The toggle is the fair-events option `fair_events_powered_by_branding`; both
 * copies read it, so a single admin switch drives every surface.
 */
class Branding {

	/**
	 * Destination for the attribution link. A lightweight ref param lets the
	 * landing site attribute organic traffic from these surfaces.
	 *
	 * @var string
	 */
	const URL = 'https://fair-event-plugins.com/?ref=poweredby';

	/**
	 * Whether the "Powered by" attribution is enabled.
	 *
	 * @return bool True when an admin has opted in.
	 */
	public static function is_enabled() {
		return (bool) get_option( 'fair_events_powered_by_branding', false );
	}

	/**
	 * Subtle attribution line for the public signup/listing blocks.
	 *
	 * @return string HTML, or '' when the branding is disabled.
	 */
	public static function block_html() {
		if ( ! self::is_enabled() ) {
			return '';
		}

		return '<p class="fair-audience-powered-by">'
			. sprintf(
				/* translators: %s: "Fair Event Plugins" linked to the project site */
				esc_html__( 'Powered by %s', 'fair-events' ),
				'<a href="' . esc_url( self::URL ) . '" target="_blank" rel="noopener nofollow">Fair Event Plugins</a>'
			)
			. '</p>';
	}
}
