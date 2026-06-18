<?php
/**
 * "Powered by Fair Event Plugins" branding markup.
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Centralizes the opt-in attribution line so the copy and link live in one
 * place, shared by the public signup blocks and the participant emails.
 *
 * The toggle is owned by fair-events (`fair_events_powered_by_branding`) but
 * rendered here. We guard purely on the option value via get_option(), which
 * returns the default when fair-events is inactive, so this keeps working even
 * if the plugins are activated independently.
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
	 * Subtle attribution line for the public signup blocks.
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
				esc_html__( 'Powered by %s', 'fair-audience' ),
				'<a href="' . esc_url( self::URL ) . '" target="_blank" rel="noopener nofollow">Fair Event Plugins</a>'
			)
			. '</p>';
	}

	/**
	 * Inline-styled attribution footer for HTML emails.
	 *
	 * Email clients strip <style> blocks, so the styling is inlined and kept
	 * small and muted to stay unobtrusive.
	 *
	 * @return string HTML, or '' when the branding is disabled.
	 */
	public static function email_footer_html() {
		if ( ! self::is_enabled() ) {
			return '';
		}

		return '<p style="margin: 16px 0 0 0; text-align: center; font-size: 12px; color: #999999;">'
			. sprintf(
				/* translators: %s: "Fair Event Plugins" linked to the project site */
				esc_html__( 'Powered by %s', 'fair-audience' ),
				'<a href="' . esc_url( self::URL ) . '" target="_blank" rel="noopener nofollow" style="color: #999999;">Fair Event Plugins</a>'
			)
			. '</p>';
	}
}
