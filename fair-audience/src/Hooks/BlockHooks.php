<?php
/**
 * Block registration hooks for Fair Audience
 *
 * @package FairAudience
 */

namespace FairAudience\Hooks;

defined( 'WPINC' ) || die;

/**
 * Handles WordPress block registration and hooks
 */
class BlockHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_action( 'init', array( $this, 'register_blocks' ) );
	}

	/**
	 * Register all block types
	 *
	 * @return void
	 */
	public function register_blocks() {
		register_block_type( FAIR_AUDIENCE_PLUGIN_DIR . 'build/blocks/mailing-signup' );
		register_block_type( FAIR_AUDIENCE_PLUGIN_DIR . 'build/blocks/event-signup' );
		register_block_type( FAIR_AUDIENCE_PLUGIN_DIR . 'build/blocks/signups-list' );

		// Set script translations for mailing-signup blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-mailing-signup-editor-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for mailing-signup blocks (frontend scripts).
		wp_set_script_translations(
			'fair-audience-mailing-signup-view-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for event-signup blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-event-signup-editor-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for event-signup blocks (frontend scripts).
		wp_set_script_translations(
			'fair-audience-event-signup-view-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);

		// Set script translations for signups-list blocks (editor scripts).
		wp_set_script_translations(
			'fair-audience-signups-list-editor-script',
			'fair-audience',
			FAIR_AUDIENCE_PLUGIN_DIR . 'build/languages'
		);
	}
}
